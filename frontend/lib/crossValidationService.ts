import { api } from './api';
import { dbDriver } from '../db/sqlite';
import { ensureDiagnosticImageUploaded } from './diagnosticImageUploadService';
import type { ChatAttachment } from './chatRepository';
import type { ConnectionMode } from '../config/network';

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

/**
 * Divergência nunca é ocultada: as duas opiniões aparecem sempre. Isto decide
 * só qual delas é apresentada como primária — a da LLM apenas quando o CV
 * local está abaixo de 70% de confiança.
 */
export function getCrossValidationPriority(
  cvConfidence: number,
  status: CrossValidationStatus
): { primary: 'CV' | 'LLM'; showBoth: boolean } {
  if (status !== 'DIVERGENT') {
    return { primary: 'CV', showBoth: false };
  }
  return {
    primary: cvConfidence < 0.7 ? 'LLM' : 'CV',
    showBoth: true,
  };
}

/** Guarda contra remontagem da tela: a segunda chamada espera a primeira. */
const validacoesEmVoo = new Map<string, Promise<CrossValidationResult | null>>();

const STATUS_TERMINAIS: ReadonlySet<string> = new Set([
  'CONFIRMED',
  'ENRICHED',
  'DIVERGENT',
  'SKIPPED',
]);

/**
 * Dispara a segunda opinião se — e só se — ela ainda está pendente e há rede
 * confiável. Devolve o veredito, ou null quando não havia o que fazer ou a
 * chamada falhou; quem chama não precisa distinguir os dois, porque em ambos
 * o caminho é reler o banco.
 *
 * Mora aqui, e não na câmera, porque é a tela de conversa que fica viva
 * durante os 3 a 5 segundos da chamada — e porque reabrir a conversa depois
 * de o app morrer no meio volta a tentar sozinho.
 */
export function runPendingCrossValidation(
  attachment: ChatAttachment,
  connectionMode: ConnectionMode
): Promise<CrossValidationResult | null> {
  const localId = attachment.diagnosticLocalId;
  if (!localId) return Promise.resolve(null);
  if (connectionMode !== 'ONLINE') return Promise.resolve(null);

  const emVoo = validacoesEmVoo.get(localId);
  if (emVoo) return emVoo;

  // Sem await antes do set: duas montagens no mesmo tick precisam encontrar
  // o mapa já populado pela primeira.
  const execucao = executarValidacaoPendente(attachment, localId).finally(() => {
    validacoesEmVoo.delete(localId);
  });
  validacoesEmVoo.set(localId, execucao);
  return execucao;
}

async function executarValidacaoPendente(
  attachment: ChatAttachment,
  localId: string
): Promise<CrossValidationResult | null> {
  const res = await dbDriver.execute(
    'SELECT cross_validation_status FROM fila_diagnosticos WHERE local_id = ?;',
    [localId]
  );
  if (res.rows.length === 0) return null;

  const status = String(res.rows._array[0].cross_validation_status ?? 'SKIPPED');
  if (STATUS_TERMINAIS.has(status)) return null;

  try {
    const { result } = await crossValidateDiagnostic({
      localId,
      imageUri: attachment.imageUri,
      imageS3Key: attachment.imageS3Key ?? null,
      cvResult: {
        doencaId: attachment.cvResult.diseaseId,
        doencaNome: attachment.diseaseName ?? 'Doença identificada pelo modelo local',
        confianca: attachment.cvResult.confidence,
        modeloUsado: attachment.cvResult.modelUsed,
        tempoInferenciaMs: attachment.cvResult.inferenceTimeMs,
      },
    });
    return result;
  } catch (error: any) {
    // SKIPPED e não PENDING: sem isso o cliente offline-first re-tentaria
    // indefinidamente, e cada ciclo custa uma leitura no S3 mais uma
    // inferência de visão paga.
    await markCrossValidationSkipped(localId, error?.code ?? 'LLM_UNAVAILABLE');
    return null;
  }
}
