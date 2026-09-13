import { dbDriver } from '../db/sqlite';
import { crossValidateDiagnostic } from './crossValidationService';
import { resolveDiseaseName } from './diagnosisDetails';
import type { StepResult } from './syncContracts';

/** Teto por diagnóstico. Cada tentativa custa uma leitura no S3 e uma inferência de visão paga. */
export const MAX_TENTATIVAS_SEGUNDA_OPINIAO = 3;

/**
 * Teto por rodada. O produtor que chega na sede com quarenta fotos offline
 * drena em duas sincronizações, em vez de disparar quarenta chamadas pagas de
 * uma vez.
 */
export const MAX_SEGUNDAS_OPINIOES_POR_RODADA = 20;

/**
 * Códigos que valem re-tentar. `IMAGE_TOO_LARGE`, `IMAGE_NOT_FOUND` e
 * `VALIDATION_ERROR` são permanentes: re-tentá-los queima inferência paga sem
 * chance de sucesso.
 */
const CODIGOS_TRANSITORIOS = ['LLM_UNAVAILABLE', 'IMAGE_UNAVAILABLE'];

/**
 * `doenca_id IS NOT NULL` exclui Saudável e Fitotoxicidade, que nunca têm
 * segunda opinião — `startDiagnosisSession` já grava nulo para os dois.
 * Código nulo é o caso principal: foto capturada sem sinal.
 */
const SQL_CANDIDATOS = `
  SELECT local_id, image_uri, image_s3_key, doenca_id,
         confianca_ia, modelo_usado, tempo_inferencia_ms
    FROM fila_diagnosticos
   WHERE cross_validation_status = 'SKIPPED'
     AND doenca_id IS NOT NULL
     AND (cross_validation_error_code IS NULL
          OR cross_validation_error_code IN (?, ?))
     AND cross_validation_retry_count < ?
   ORDER BY timestamp ASC
   LIMIT ?;
`;

/**
 * Re-tenta a segunda opinião que não aconteceu por falta de rede.
 *
 * Não produz mensagem nova: o card relê `fila_diagnosticos` a cada abertura da
 * conversa. E não devolve o diagnóstico para PENDING — quem persistiu o
 * veredito no servidor foi o próprio `/diagnosis/cross-validate`.
 */
export async function sweepPendingSecondOpinions(): Promise<StepResult> {
  const res = await dbDriver.execute(SQL_CANDIDATOS, [
    CODIGOS_TRANSITORIOS[0],
    CODIGOS_TRANSITORIOS[1],
    MAX_TENTATIVAS_SEGUNDA_OPINIAO,
    MAX_SEGUNDAS_OPINIOES_POR_RODADA,
  ]);

  const candidatos: Array<Record<string, any>> = [];
  for (let i = 0; i < res.rows.length; i++) candidatos.push(res.rows.item(i));
  if (candidatos.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  for (const linha of candidatos) {
    try {
      await crossValidateDiagnostic({
        localId: linha.local_id,
        imageUri: linha.image_uri,
        imageS3Key: linha.image_s3_key ?? null,
        cvResult: {
          doencaId: linha.doenca_id,
          doencaNome: await resolveDiseaseName(linha.doenca_id),
          confianca: linha.confianca_ia ?? 0,
          modeloUsado: linha.modelo_usado,
          tempoInferenciaMs: linha.tempo_inferencia_ms ?? 0,
        },
      });
      synced += 1;
    } catch (erro: any) {
      // Gravar o código é o que faz o seletor se auto-corrigir: um erro
      // permanente descoberto agora tira a linha das próximas rodadas.
      await dbDriver.execute(
        `UPDATE fila_diagnosticos
            SET cross_validation_retry_count = cross_validation_retry_count + 1,
                cross_validation_error_code = ?
          WHERE local_id = ?;`,
        [erro?.code ?? 'LLM_UNAVAILABLE', linha.local_id]
      );
      failed += 1;
    }
  }

  return { synced, failed };
}
