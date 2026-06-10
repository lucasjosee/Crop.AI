# Sprint 5 — Store & Forward + Sincronização (Design)

**Data:** 2026-06-10
**Status:** Aprovado para planejamento
**Referências:** `Documentação/MVP/Contratos de API.md` (seções 4–8), `Documentação/MVP/Plano de Implementação (Sprints).md` (Sprint 5)

## Objetivo

Tudo que foi produzido offline (diagnósticos, feedbacks, logs de uso do SLM) é sincronizado com o servidor quando o produtor recupera conectividade, e o catálogo local é atualizado incrementalmente (delta sync) a partir do PostgreSQL.

## Decisões tomadas no brainstorming

| Decisão | Escolha |
|---|---|
| Infraestrutura S3 | **MinIO local via Docker** (S3-compatível; migrar para AWS real = trocar env) |
| Gatilho do sync | **Automático na transição FIELD → ONLINE + botão manual** (badge na home) |
| Arquitetura frontend | **Abordagem A**: orquestrador único `syncService.ts` + `useSyncStore` (sem queue manager genérico, sem background task nativo) |
| Escopo extra | Captura de logs SLM na `fila_slm_logs` (hoje nada escreve nela; necessário para o gate T5.5) |

## Backend

### Infraestrutura (MinIO)

- `docker-compose.yml`: serviço `minio` (portas 9000 API / 9001 console) com volume persistente + init-container `minio/mc` que cria o bucket `plant-diagnostics`.
- `env.ts` (novas variáveis, validadas com Zod): `S3_ENDPOINT` (opcional; presente em dev apontando para MinIO), `S3_REGION` (default `us-east-1`), `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`.
- Client S3 com `forcePathStyle: true` quando `S3_ENDPOINT` está definido.
- **Atenção dev**: `S3_ENDPOINT` deve usar o IP da LAN (não `localhost`) para o celular alcançar a presigned URL.
- Dependências novas: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`.

### Módulo `upload/`

`POST /api/v1/upload/url` (autenticado):

- Valida `content_type` ∈ {`image/jpeg`, `image/png`}; `filename` obrigatório.
- Gera `s3_key = diagnosticos/{userId}/{uuid}.{ext}`.
- Presigned PUT com validade **600s** e `Content-Type` travado.
- Resposta: `{ upload_url, s3_key, expires_in: 600 }`.
- **Limitação conhecida**: o limite de 10MB é validado no app; presigned PUT não impõe `content-length-range` (recurso da forma POST).

### Módulo `sync/`

Três endpoints batch, autenticados, rate limit **30 req/min**:

**`POST /sync/diagnostics`** (200):
- Por item: valida `doenca_id` contra o catálogo; inválido → entra em `failed_items` com `error_code: INVALID_DOENCA_ID`.
- Dedup por `mobile_local_id`: se já existe, retorna o `server_id` existente como item sincronizado (idempotente).
- Após inserir, vincula feedbacks órfãos: `feedbacks_diagnostico` com mesmo `mobile_local_id` e status `PENDING_DIAGNOSTIC` recebem `diagnostico_id` e passam a `PROCESSED`.
- Resposta: `{ status: "success"|"partial", synced_count, failed_count, synced_items: [{local_id, server_id}], failed_items: [{local_id, error_code, message}] }`.

**`POST /sync/feedback`** (202):
- Busca o diagnóstico por `diagnostic_server_id` ou `diagnostic_local_id`.
- Não encontrado → aceita com `status: PENDING_DIAGNOSTIC` e `diagnostico_id: null`.
- Dedup por (`user_id`, `mobile_local_id`) — um feedback por diagnóstico; duplicata retorna o feedback existente.
- Resposta: `{ status, processed_count, failed_count, processed_items: [{diagnostic_local_id, feedback_id}], failed_items }`.

**`POST /sync/slm-logs`** (202):
- Insere `sessoes_slm` (dedup por `user_id` + `mobile_session_id`) e as `interacoes_slm` da sessão.
- `rag_used_documents` aceito e persistido como `[]` no MVP.
- Resposta: `{ status, processed_count }`.

### Módulo `catalog/`

`GET /api/v1/catalog/sync` (autenticado, rate limit **60 req/min**):

- **ETag**: opaco para o cliente; internamente `"{maxUpdatedAtISO}:{sha256(contadores + max updated_at das 4 tabelas)}"`.
  - `If-None-Match` igual ao atual → `304 Not Modified` (sem body).
  - Diferente → servidor extrai o timestamp do ETag do cliente e retorna linhas com `updated_at` posterior.
  - Sem ETag (instalação nova) → catálogo completo como upserts.
- **Cursor pagination**: ordem fixa de tabelas (culturas → doencas → defensivos → doenca_defensivo), cada uma ordenada por (`updated_at`, `id`); cursor opaco base64; `limit` default 100.
- **Deletes**: `is_active = false` → `{ action: "delete", id }`. `doenca_defensivo` só tem upsert no MVP.
- Resposta: `{ catalog_version_hash, next_cursor, has_more, updates: { culturas, doencas, defensivos, doenca_defensivo } }` — inclui as 4 tabelas (o contrato exemplifica 2; o espelho local precisa das 4).

## Frontend

### Migração SQLite v4

- Nova tabela `sync_metadata (key TEXT PRIMARY KEY, value TEXT)` — guarda `catalog_etag` e `last_sync_at`.
- Filas existentes não mudam (já têm `image_s3_key`, `server_id`, `sync_status`, `retry_count`).

### `lib/syncService.ts` (orquestrador)

`runFullSync()` com guard (online + autenticado + não está rodando) e pipeline sequencial:

1. **Diagnósticos**: itens `PENDING` e `FAILED` com `retry_count < 5`. Para cada um sem `image_s3_key`: presigned URL → PUT da imagem (`expo-file-system` `uploadAsync` no nativo) → grava `s3_key` no SQLite **antes** de prosseguir (falha no meio mantém `PENDING` e retoma do ponto certo). Itens cujo upload falhou ficam **fora** do lote desta rodada. Depois, lote para `/sync/diagnostics` apenas com itens que têm `image_s3_key`; `synced_items` → `SYNCED` + `server_id`; `failed_items` → `retry_count++`, ao atingir 5 → `FAILED`.
2. **Feedbacks**: lote para `/sync/feedback`, mesmas transições.
3. **Logs SLM**: lote para `/sync/slm-logs`, idem.
4. **Catálogo**: delega ao `catalogSyncService`.
5. **Cleanup**: `DELETE` de registros `SYNCED` com mais de 30 dias nas três filas.

Sync manual (botão) inclui itens `FAILED`, resetando o ciclo de retry.

### `lib/catalogSyncService.ts`

- Lê `catalog_etag` de `sync_metadata`; `GET /catalog/sync` com `If-None-Match`.
- `304` → termina. `200` → aplica `updates` página a página (upsert/delete nas 4 tabelas locais, na ordem do backend), recalculando `causa` com `getCausaByNomeCientifico` no upsert de doenças.
- Persiste o novo ETag **somente** após a última página (`has_more: false`); interrupção no meio → próximo sync recomeça do ETag antigo.

### `store/useSyncStore.ts`

- Estado: `pendingCounts` (por fila), `isSyncing`, `lastSyncAt`, `lastError`.
- Ações: `refreshCounts()`, `syncNow()`.
- Gatilho automático: subscribe no `useNetworkStore` (em `_layout.tsx`) na transição `FIELD → ONLINE` → `syncNow()` com debounce contra oscilações.
- Delta sync do catálogo também roda ao abrir o app, se online.

### Captura de logs SLM (`useChatStore`)

- No modo offline (SLM), cada troca prompt/resposta é gravada na `fila_slm_logs` com upsert por `session_id`, acumulando em `interactions_json` a cada interação (nada se perde se o app fechar). `session_id` e `model_version` já existem no store.

### UI de Sync (home `index.tsx`)

- Badge "Você tem X diagnósticos para sincronizar" quando `pendingCounts > 0`; botão "Sincronizar agora"; estado visual durante o sync; badge some ao zerar. Usa componentes existentes (Badge, Button, Card).

## Tratamento de erros

- Upload S3 falhou → item permanece `PENDING`; retomado no próximo sync (presigned URL nova é pedida se necessário).
- Item rejeitado pelo servidor (`failed_items`) → `retry_count++`; em 5 falhas → `FAILED` (só sync manual reprocessa).
- `429` do rate limit → interrompe o lote atual; itens restantes permanecem `PENDING` para o próximo ciclo.
- Catálogo interrompido no meio da paginação → ETag antigo preservado; reaplicação de upserts é idempotente.

## Testes (gates da Sprint 5)

**Backend (integração, padrão dos testes existentes):**
- Presigned URL com client S3 mockado (T5.1 em nível de unidade; upload real ao MinIO validado manualmente).
- Batch sync de 3 diagnósticos → 3 registros com `server_id` (T5.2, lado servidor).
- Dedup: mesmo `local_id` 2× → 1 registro, sem erro (T5.3).
- Feedback antes do diagnóstico → `PENDING_DIAGNOSTIC`; sync posterior do diagnóstico vincula retroativamente (T5.4).
- SLM logs → sessão + interações persistidas (T5.5).
- Catálogo: ETag igual → `304` (T5.7); alteração em doença → delta correto (T5.6).

**Frontend (unitários, padrão dos testes existentes):**
- `syncService`: fluxo feliz com `dbDriver`/`fetch` mockados (T5.2, lado app); falha de upload mantém `PENDING` (T5.8); transições de retry/`FAILED`.
- `catalogSyncService`: aplicação de upsert/delete; ETag persistido só no fim.
- `useSyncStore`: contagens e guard de concorrência (T5.9 em nível de lógica).

**Validação manual:** T5.1 (upload real no MinIO) e T5.9 (badge na UI).

## Fora de escopo

- UI de feedback do produtor (Sprint 6) — aqui só o pipeline de sync da `fila_feedbacks`.
- Cross-validation no servidor durante o sync (opcional no contrato; Sprint 6).
- Background sync com app fechado (descartado no brainstorming — YAGNI para o MVP).
- RAG vetorial (`rag_used_documents` sempre `[]`).
