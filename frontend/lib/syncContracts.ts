/**
 * Contratos compartilhados pelas etapas do sync.
 *
 * Módulo próprio para que `conversationSyncService` e `pendingSecondOpinionService`
 * não precisem importar de `syncService` — que importa os dois de volta.
 */

export const MAX_RETRIES = 5;
export const CLEANUP_DAYS = 30;

export interface StepResult {
  synced: number;
  failed: number;
}
