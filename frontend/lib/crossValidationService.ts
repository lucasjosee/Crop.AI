import { api } from './api';
import { dbDriver } from '../db/sqlite';
import { ensureDiagnosticImageUploaded } from './diagnosticImageUploadService';

export type CrossValidationStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'ENRICHED'
  | 'DIVERGENT'
  | 'SKIPPED';

export interface CrossValidationResult {
  result_status: Exclude<CrossValidationStatus, 'PENDING' | 'SKIPPED'>;
  llm_agrees_with_cv: boolean;
  llm_doenca_id: string | null;
  llm_doenca_nome: string | null;
  llm_observacoes: string;
  llm_confianca: number;
}

export interface CrossValidateDiagnosticInput {
  localId: string;
  imageUri: string;
  imageS3Key?: string | null;
  onImageUploaded?: (imageS3Key: string) => void;
  cvResult: {
    doencaId: string;
    doencaNome: string;
    confianca: number;
    modeloUsado: string;
    tempoInferenciaMs: number;
  };
}

export class CrossValidationRequestError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export async function crossValidateDiagnostic(
  input: CrossValidateDiagnosticInput
): Promise<{ imageS3Key: string; result: CrossValidationResult }> {
  const imageS3Key = await ensureDiagnosticImageUploaded({
    localId: input.localId,
    imageUri: input.imageUri,
    imageS3Key: input.imageS3Key,
  });
  input.onImageUploaded?.(imageS3Key);

  // Só a chamada de rede fica no try: envolver também o UPDATE local fazia uma
  // falha de banco (ex.: FK de llm_doenca_id com catálogo desatualizado) virar
  // LLM_UNAVAILABLE. O app então marcava SKIPPED, o guard do servidor impedia a
  // auto-correção no sync seguinte, e cliente e servidor divergiam para sempre
  // — com a segunda opinião real existindo no servidor e nunca aparecendo.
  let result: CrossValidationResult;
  try {
    const { data } = await api.post(
      '/api/v1/diagnosis/cross-validate',
      {
        diagnostic_local_id: input.localId,
        image_s3_key: imageS3Key,
        cv_result: {
          doenca_id: input.cvResult.doencaId,
          doenca_nome: input.cvResult.doencaNome,
          confianca: input.cvResult.confianca,
          modelo_usado: input.cvResult.modeloUsado,
          tempo_inferencia_ms: input.cvResult.tempoInferenciaMs,
        },
      },
      { timeout: 17_000 }
    );
    result = data.cross_validation as CrossValidationResult;
  } catch (error: any) {
    const code = error?.response?.data?.error?.code ?? 'LLM_UNAVAILABLE';
    throw new CrossValidationRequestError(code);
  }

  await dbDriver.execute(
    `UPDATE fila_diagnosticos
     SET cross_validation_status = ?, llm_doenca_id = ?, llm_doenca_nome = ?,
         llm_confianca = ?, llm_observacoes = ?, cross_validation_error_code = ?
     WHERE local_id = ?;`,
    [
      result.result_status,
      result.llm_doenca_id,
      result.llm_doenca_nome,
      result.llm_confianca,
      result.llm_observacoes,
      null,
      input.localId,
    ]
  );
  return { imageS3Key, result };
}

export async function markCrossValidationSkipped(
  localId: string,
  errorCode: string | null = null
): Promise<void> {
  await dbDriver.execute(
    'UPDATE fila_diagnosticos SET cross_validation_status = ?, cross_validation_error_code = ? WHERE local_id = ?;',
    ['SKIPPED', errorCode, localId]
  );
}

export function getCrossValidationPriority(
  cvConfidence: number,
  result: CrossValidationResult
): { primary: 'CV' | 'LLM'; showBoth: boolean } {
  if (result.result_status !== 'DIVERGENT') {
    return { primary: 'CV', showBoth: false };
  }
  return {
    primary: cvConfidence < 0.7 ? 'LLM' : 'CV',
    showBoth: true,
  };
}
