/**
 * Contratos compartilhados pelas etapas do sync.
 *
 * Módulo próprio para que `conversationSyncService` e `pendingSecondOpinionService`
 * não precisem importar de `syncService` — que importa os dois de volta.
 */

export const MAX_RETRIES = 5;

/**
 * Teto de itens por requisição em /sync/diagnostics e /sync/feedback. É o do
 * servidor (`sync.schema.ts`, 1 a 50): acima dele o lote inteiro leva 400 e
 * nenhum item avança.
 */
export const MAX_ITENS_POR_LOTE = 50;

export interface StepResult {
  synced: number;
  failed: number;
}
