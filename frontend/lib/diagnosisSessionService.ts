import { randomUUID } from 'expo-crypto';
import { dbDriver } from '../db/sqlite';
import { saveImagePersistently } from './imageHelper';
import { appendMessage, createSession, type ChatAttachment } from './chatRepository';
import type { InferenceResult } from './inference';
import type { ConnectionMode } from '../config/network';

/** Os dois ids que não existem no catálogo e nunca têm segunda opinião. */
const ESPECIAIS = new Set(['Saudável', 'Fitotoxicidade']);

export interface StartDiagnosisSessionInput {
  imageUri: string;
  inference: InferenceResult;
  /** Já resolvido pela câmera para o chip da confirmação; vira o título da sessão. */
  diseaseName: string;
  gps: { latitude: number; longitude: number };
  connectionMode: ConnectionMode;
}

export interface StartedDiagnosisSession {
  sessionId: string;
  diagnosticLocalId: string;
}

/**
 * A foto confirmada vira diagnóstico, sessão e primeira mensagem.
 *
 * Nada é gravado antes de o produtor tocar em "Analisar": 3 a 5 tentativas até
 * um bom quadro é o normal em campo, e cada tentativa persistida custaria uma
 * sessão no histórico, um PUT no S3 e uma chamada paga ao modelo.
 */
export async function startDiagnosisSession(
  input: StartDiagnosisSessionInput
): Promise<StartedDiagnosisSession> {
  const imageUri = await saveImagePersistently(input.imageUri);
  const diagnosticLocalId = randomUUID();
  const isEspecial = ESPECIAIS.has(input.inference.diseaseId);

  // Offline não há como pedir a segunda opinião, e deixar PENDING pendurado
  // faria o app re-tentar para sempre — é por isso que duas migrações já
  // varreram PENDING para SKIPPED. Quando o re-sync do veredito existir
  // (sub-projeto 4), esta regra pode ser revista.
  const crossValidationStatus =
    isEspecial || input.connectionMode !== 'ONLINE' ? 'SKIPPED' : 'PENDING';

  await dbDriver.execute(
    `INSERT INTO fila_diagnosticos (
      local_id, server_id, image_uri, image_s3_key, latitude, longitude,
      doenca_id, confianca_ia, modelo_usado, tempo_inferencia_ms,
      sync_status, retry_count, cross_validation_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      diagnosticLocalId,
      null,
      imageUri,
      null,
      input.gps.latitude,
      input.gps.longitude,
      isEspecial ? null : input.inference.diseaseId,
      input.inference.confidence,
      input.inference.modelUsed,
      input.inference.inferenceTimeMs,
      'PENDING',
      0,
      crossValidationStatus,
    ]
  );

  try {
    const session = await createSession({
      title: input.diseaseName,
      originDiagnosticLocalId: diagnosticLocalId,
    });

    const attachment: ChatAttachment = {
      imageUri,
      cvResult: input.inference,
      diseaseName: input.diseaseName,
      diagnosticLocalId,
    };

    // content vazio é deliberado: ninguém digita nada para tirar uma foto, e
    // cada motor já prefixa a instrução que precisa. Inventar um texto de
    // usuário seria mentira no histórico.
    await appendMessage({ sessionId: session.id, role: 'user', content: '', attachment });

    return { sessionId: session.id, diagnosticLocalId };
  } catch (error) {
    // O driver não tem transação. Sem esta compensação, um diagnóstico ficaria
    // órfão: sincronizaria, gastaria um PUT no S3, e não apareceria em lista
    // nenhuma — mapa e histórico consultam a partir de chat_sessions.
    await dbDriver
      .execute("DELETE FROM fila_diagnosticos WHERE local_id = ? AND sync_status = 'PENDING';", [
        diagnosticLocalId,
      ])
      .catch(() => undefined);
    throw error;
  }
}
