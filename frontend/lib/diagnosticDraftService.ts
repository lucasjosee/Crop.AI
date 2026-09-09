import { dbDriver } from '../db/sqlite';

/**
 * Descarta um diagnóstico que o produtor abandonou antes de confirmar.
 *
 * A persistência passou a acontecer automaticamente logo após a inferência, e
 * não mais quando o produtor tocava em "Salvar no Histórico". Sem descartar o
 * rascunho no Retake, cada tentativa enquadrada de novo permanecia na fila:
 * subia para o servidor no próximo sync e ainda consumia um PUT no S3 — num app
 * de campo, com conexão instável, onde 3 a 5 tentativas até um bom quadro é o
 * comportamento normal.
 *
 * Só remove o que ainda está PENDING: uma linha já sincronizada é histórico do
 * produtor, não rascunho.
 */
export async function discardDiagnosticDraft(localId: string | null): Promise<void> {
  if (!localId) return;

  await dbDriver.execute(
    "DELETE FROM fila_diagnosticos WHERE local_id = ? AND sync_status = 'PENDING';",
    [localId]
  );
}
