# Sprint 5 — Store & Forward + Sincronização — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sincronizar tudo que foi produzido offline (diagnósticos com imagens, feedbacks, logs SLM) quando o produtor recupera conectividade, e atualizar o catálogo local via delta sync com ETag.

**Architecture:** Backend ganha 3 módulos novos no padrão existente (`upload/` presigned URL via MinIO/S3, `sync/` 3 endpoints batch idempotentes, `catalog/` delta sync com ETag+cursor). Frontend ganha um orquestrador único `syncService.ts` (pipeline sequencial), `catalogSyncService.ts`, `useSyncStore` (Zustand) com gatilho automático na transição FIELD→ONLINE, e captura de logs SLM no chat offline.

**Tech Stack:** Fastify + Drizzle + PostgreSQL + `@aws-sdk/client-s3`/`s3-request-presigner` + MinIO (dev). Expo/React Native + Zustand + op-sqlite + axios. Vitest em ambos.

**Spec:** `docs/superpowers/specs/2026-06-10-sprint5-store-forward-sync-design.md`

**Convenções deste repo:**
- Backend: módulos em `backend/src/modules/<nome>/` com `*.routes.ts`, `*.controller.ts`, `*.service.ts`, `*.schema.ts`. Testes de integração usam o Postgres real (`app.inject`, padrão de `chat.routes.test.ts`: login retorna `access_token` no body). Rodar testes: `cd backend && npx vitest run <path>`.
- Frontend: testes unitários com mocks de módulo (`vi.mock`), padrão de `store/store.test.ts` (importa `./test-globals` primeiro). Rodar: `cd frontend && npx vitest run <path>`.
- **Frontend/Expo:** `frontend/AGENTS.md` exige consultar https://docs.expo.dev/versions/v56.0.0/ antes de escrever código que use APIs do Expo (relevante na Task 9 para `expo-file-system`).
- Commits frequentes, mensagens em inglês com prefixo `feat(backend):`, `feat(web):`, `test:` etc. (padrão do histórico), rodapé `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## File Structure (visão geral)

**Backend (criar):**
- `backend/src/config/s3.ts` — client S3 singleton (MinIO em dev)
- `backend/src/modules/upload/{upload.schema,upload.service,upload.controller,upload.routes,upload.test}.ts`
- `backend/src/modules/sync/{sync.schema,sync.service,sync.controller,sync.routes}.ts` + `sync.diagnostics.test.ts`, `sync.feedback.test.ts`, `sync.slmlogs.test.ts`
- `backend/src/modules/catalog/{catalog.service,catalog.controller,catalog.routes}.ts` + `catalog.test.ts`

**Backend (modificar):**
- `docker-compose.yml` — serviços `minio` + `minio-init`
- `backend/src/config/env.ts` — variáveis S3
- `backend/src/app.ts` — registrar 3 módulos com rate limits
- `.env` (raiz) — credenciais MinIO dev

**Frontend (criar):**
- `frontend/lib/catalogSyncService.ts` + `frontend/lib/catalogSyncService.test.ts`
- `frontend/lib/syncService.ts` + `frontend/lib/syncService.test.ts`
- `frontend/store/useSyncStore.ts` + `frontend/store/useSyncStore.test.ts`
- `frontend/db/sqliteSync.test.ts`
- `frontend/store/chatSlmLog.test.ts`

**Frontend (modificar):**
- `frontend/db/sqlite.ts` — migração v4 (`sync_metadata`), helpers `getSyncMeta`/`setSyncMeta`, handlers genéricos no `WebDatabaseDriver`
- `frontend/store/useChatStore.ts` — ação `logSlmInteraction`
- `frontend/app/chat.tsx` — captura prompt/resposta/latência do SLM
- `frontend/app/index.tsx` — badge + botão "Sincronizar agora"
- `frontend/app/_layout.tsx` — gatilho FIELD→ONLINE

---

## Task 1: Infra — MinIO no Docker Compose + env S3 + dependências AWS SDK

**Files:**
- Modify: `docker-compose.yml`
- Modify: `backend/src/config/env.ts`
- Modify: `.env` (raiz do repo)
- Modify: `backend/package.json` (via npm install)

- [ ] **Step 1: Adicionar MinIO ao docker-compose.yml**

Adicionar aos `services:` (mantendo `db` intacto) e ao bloco `volumes:`:

```yaml
  minio:
    image: minio/minio:latest
    container_name: app_diagnostico_minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minio_admin
      MINIO_ROOT_PASSWORD: minio_password
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - miniodata:/data
    restart: unless-stopped

  minio-init:
    image: minio/mc:latest
    container_name: app_diagnostico_minio_init
    depends_on:
      - minio
    entrypoint: >
      /bin/sh -c "
      until mc alias set local http://minio:9000 minio_admin minio_password; do sleep 1; done;
      mc mb --ignore-existing local/plant-diagnostics;
      exit 0;
      "
```

E em `volumes:` (no final do arquivo): adicionar `miniodata:` abaixo de `pgdata:`.

- [ ] **Step 2: Subir e verificar**

Run: `docker compose up -d minio minio-init && sleep 5 && docker compose logs minio-init | tail -3`
Expected: log contendo `Bucket created successfully` ou `already own it` (re-runs).

- [ ] **Step 3: Adicionar variáveis S3 ao env.ts**

Em `backend/src/config/env.ts`, adicionar ao `envSchema` após `LLM_MODEL_ID`:

```ts
  // S3 / MinIO (dev usa MinIO local; produção AWS S3 = trocar endpoint/keys)
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().default('plant-diagnostics'),
```

- [ ] **Step 4: Adicionar ao `.env` da raiz**

```
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=minio_admin
S3_SECRET_KEY=minio_password
S3_BUCKET=plant-diagnostics
```

> NOTA: para testar com celular físico, `S3_ENDPOINT` deve usar o IP da LAN (ex: `http://192.168.x.x:9000`), igual ao `EXPO_PUBLIC_API_URL` — senão a presigned URL aponta para `localhost` do telefone.

- [ ] **Step 5: Instalar dependências**

Run: `cd backend && npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`

- [ ] **Step 6: Verificar que nada quebrou**

Run: `cd backend && npx vitest run`
Expected: suíte existente passa (requer Postgres do compose rodando e `.env` válido).

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml backend/src/config/env.ts backend/package.json backend/package-lock.json
git commit -m "feat(infra): add MinIO S3-compatible storage and S3 env config"
```

(`.env` não é commitado — está no .gitignore.)

---

## Task 2: Backend — módulo `upload/` (Presigned URL)

**Files:**
- Create: `backend/src/config/s3.ts`
- Create: `backend/src/modules/upload/upload.schema.ts`
- Create: `backend/src/modules/upload/upload.service.ts`
- Create: `backend/src/modules/upload/upload.controller.ts`
- Create: `backend/src/modules/upload/upload.routes.ts`
- Test: `backend/src/modules/upload/upload.test.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Escrever os testes (falham)**

`backend/src/modules/upload/upload.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { app } from '../../app';
import { db } from '../../db';
import { usuarios, refreshTokens } from '../../db/schema';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://minio.local/presigned-put-url?X-Amz-Signature=abc'),
}));

describe('UploadService (unit)', () => {
  it('gera s3_key no formato diagnosticos/{userId}/{uuid}.jpg e expiry 600s', async () => {
    const { uploadService } = await import('./upload.service');
    const res = await uploadService.createUploadUrl('user-123', 'image/jpeg');
    expect(res.upload_url).toContain('presigned-put-url');
    expect(res.s3_key).toMatch(/^diagnosticos\/user-123\/[0-9a-f-]{36}\.jpg$/);
    expect(res.expires_in).toBe(600);
  });

  it('usa extensão .png para image/png', async () => {
    const { uploadService } = await import('./upload.service');
    const res = await uploadService.createUploadUrl('user-123', 'image/png');
    expect(res.s3_key).toMatch(/\.png$/);
  });
});

describe('POST /api/v1/upload/url (integration)', () => {
  let accessToken: string;

  beforeAll(async () => {
    await app.ready();
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { nome: 'Upload Tester', email: 'upload@test.com', password: 'senha123!' },
    });
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'upload@test.com', password: 'senha123!' },
    });
    accessToken = JSON.parse(loginRes.body).access_token;
  });

  afterAll(async () => {
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.close();
  });

  it('retorna 401 sem token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/upload/url',
      payload: { filename: 'foto.jpg', content_type: 'image/jpeg' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('retorna 400 para content_type não suportado', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/upload/url',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { filename: 'doc.pdf', content_type: 'application/pdf' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('retorna upload_url, s3_key e expires_in (T5.1 unit-level)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/upload/url',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { filename: 'diagnostico_2026-06-10.jpg', content_type: 'image/jpeg' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.upload_url).toBeTruthy();
    expect(body.s3_key).toMatch(/^diagnosticos\//);
    expect(body.expires_in).toBe(600);
  });
});
```

- [ ] **Step 2: Rodar para confirmar falha**

Run: `cd backend && npx vitest run src/modules/upload`
Expected: FAIL — `Cannot find module './upload.service'` (ou rota 404).

- [ ] **Step 3: Implementar**

`backend/src/config/s3.ts`:

```ts
import { S3Client } from '@aws-sdk/client-s3';
import { env } from './env';

// MinIO em dev (endpoint custom + path style); AWS S3 real quando S3_ENDPOINT ausente
export const s3Client = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: !!env.S3_ENDPOINT,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
});
```

`backend/src/modules/upload/upload.schema.ts`:

```ts
import { z } from 'zod';

export const uploadUrlSchema = z.object({
  filename: z.string().min(1),
  content_type: z.enum(['image/jpeg', 'image/png']),
});

export type UploadUrlInput = z.infer<typeof uploadUrlSchema>;
```

`backend/src/modules/upload/upload.service.ts`:

```ts
import { randomUUID } from 'crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client } from '../../config/s3';
import { env } from '../../config/env';

const EXPIRES_IN_SECONDS = 600;

export class UploadService {
  async createUploadUrl(userId: string, contentType: 'image/jpeg' | 'image/png') {
    const ext = contentType === 'image/png' ? 'png' : 'jpg';
    const s3Key = `diagnosticos/${userId}/${randomUUID()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: s3Key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: EXPIRES_IN_SECONDS });

    return { upload_url: uploadUrl, s3_key: s3Key, expires_in: EXPIRES_IN_SECONDS };
  }
}

export const uploadService = new UploadService();
```

`backend/src/modules/upload/upload.controller.ts`:

```ts
import { FastifyRequest, FastifyReply } from 'fastify';
import { uploadUrlSchema } from './upload.schema';
import { uploadService } from './upload.service';

export const uploadController = {
  async createUrl(request: FastifyRequest, reply: FastifyReply) {
    const body = uploadUrlSchema.parse(request.body);
    const user = request.user as { sub: string };
    const result = await uploadService.createUploadUrl(user.sub, body.content_type);
    return reply.code(200).send(result);
  },
};
```

`backend/src/modules/upload/upload.routes.ts`:

```ts
import { FastifyInstance } from 'fastify';
import { uploadController } from './upload.controller';
import { authenticate } from '../../plugins/authenticate';

export async function uploadRoutes(fastify: FastifyInstance) {
  fastify.post('/url', { preHandler: [authenticate] }, uploadController.createUrl);
}

export default uploadRoutes;
```

Em `backend/src/app.ts`, após o registro de `chatRoutes`:

```ts
import uploadRoutes from './modules/upload/upload.routes';
// ...
app.register(uploadRoutes, { prefix: '/api/v1/upload' });
```

- [ ] **Step 4: Rodar testes**

Run: `cd backend && npx vitest run src/modules/upload`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add backend/src/config/s3.ts backend/src/modules/upload backend/src/app.ts
git commit -m "feat(backend): add presigned URL endpoint for S3 image upload"
```

---

## Task 3: Backend — `POST /sync/diagnostics` (batch + dedup + vínculo de feedbacks)

**Files:**
- Create: `backend/src/modules/sync/sync.schema.ts`
- Create: `backend/src/modules/sync/sync.service.ts`
- Create: `backend/src/modules/sync/sync.controller.ts`
- Create: `backend/src/modules/sync/sync.routes.ts`
- Test: `backend/src/modules/sync/sync.diagnostics.test.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Escrever o teste (falha)**

`backend/src/modules/sync/sync.diagnostics.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { app } from '../../app';
import { db } from '../../db';
import {
  usuarios, refreshTokens, culturas, doencas, diagnosticos, feedbacksDiagnostico,
} from '../../db/schema';

const culturaId = `cultura-test-${randomUUID()}`;
let doencaId: string;
let accessToken: string;

function makeDiagnostic(localId: string) {
  return {
    local_id: localId,
    timestamp: '2026-06-10T08:30:00Z',
    image_s3_key: `diagnosticos/test/${localId}.jpg`,
    location: { lat: -23.55052, lng: -46.633309 },
    ai_result: {
      doenca_id: doencaId,
      confianca: 0.88,
      modelo_usado: 'tflite_v1.0',
      tempo_inferencia_ms: 45,
    },
  };
}

describe('POST /api/v1/sync/diagnostics (integration)', () => {
  beforeAll(async () => {
    await app.ready();
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { nome: 'Sync Tester', email: 'sync-diag@test.com', password: 'senha123!' },
    });
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'sync-diag@test.com', password: 'senha123!' },
    });
    accessToken = JSON.parse(loginRes.body).access_token;

    await db.insert(culturas).values({ id: culturaId, nome: 'Soja Teste', estagioFenologicoPadrao: [] });
    const [d] = await db
      .insert(doencas)
      .values({ idCultura: culturaId, nomeComum: 'Doenca Sync Teste', sintomas: 'manchas' })
      .returning({ id: doencas.id });
    doencaId = d.id;
  });

  afterAll(async () => {
    await db.delete(feedbacksDiagnostico);
    await db.delete(diagnosticos);
    await db.delete(doencas).where(eq(doencas.id, doencaId));
    await db.delete(culturas).where(eq(culturas.id, culturaId));
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.close();
  });

  it('retorna 401 sem token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/diagnostics',
      payload: { diagnostics: [makeDiagnostic(randomUUID())] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('sincroniza lote de 3 diagnósticos (T5.2)', async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/diagnostics',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { diagnostics: ids.map(makeDiagnostic) },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('success');
    expect(body.synced_count).toBe(3);
    expect(body.failed_count).toBe(0);
    expect(body.synced_items).toHaveLength(3);
    for (const item of body.synced_items) {
      expect(item.server_id).toBeTruthy();
      const [row] = await db.select().from(diagnosticos).where(eq(diagnosticos.mobileLocalId, item.local_id));
      expect(row).toBeTruthy();
      expect(row.imageS3Key).toContain(item.local_id);
    }
  });

  it('é idempotente para o mesmo local_id (T5.3)', async () => {
    const localId = randomUUID();
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/diagnostics',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { diagnostics: [makeDiagnostic(localId)] },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/diagnostics',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { diagnostics: [makeDiagnostic(localId)] },
    });
    expect(second.statusCode).toBe(200);
    const firstBody = JSON.parse(first.body);
    const secondBody = JSON.parse(second.body);
    expect(secondBody.status).toBe('success');
    expect(secondBody.synced_items[0].server_id).toBe(firstBody.synced_items[0].server_id);

    const rows = await db.select().from(diagnosticos).where(eq(diagnosticos.mobileLocalId, localId));
    expect(rows).toHaveLength(1);
  });

  it('retorna partial com INVALID_DOENCA_ID para doença inexistente', async () => {
    const bad = makeDiagnostic(randomUUID());
    bad.ai_result = { ...bad.ai_result, doenca_id: randomUUID() };
    const ok = makeDiagnostic(randomUUID());

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/diagnostics',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { diagnostics: [ok, bad] },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('partial');
    expect(body.synced_count).toBe(1);
    expect(body.failed_count).toBe(1);
    expect(body.failed_items[0].error_code).toBe('INVALID_DOENCA_ID');
  });
});
```

- [ ] **Step 2: Rodar para confirmar falha**

Run: `cd backend && npx vitest run src/modules/sync/sync.diagnostics.test.ts`
Expected: FAIL — rota 404 / módulo inexistente.

- [ ] **Step 3: Implementar**

`backend/src/modules/sync/sync.schema.ts`:

```ts
import { z } from 'zod';

export const syncDiagnosticsSchema = z.object({
  diagnostics: z
    .array(
      z.object({
        local_id: z.string().uuid(),
        timestamp: z.string(),
        image_s3_key: z.string().min(1),
        location: z.object({ lat: z.number(), lng: z.number() }),
        ai_result: z.object({
          doenca_id: z.string().uuid(),
          confianca: z.number(),
          modelo_usado: z.string().min(1),
          tempo_inferencia_ms: z.number().int(),
        }),
      })
    )
    .min(1)
    .max(50),
});

export const syncFeedbackSchema = z.object({
  feedbacks: z
    .array(
      z.object({
        diagnostic_server_id: z.string().uuid().nullable().optional(),
        diagnostic_local_id: z.string().uuid(),
        timestamp_feedback: z.string(),
        is_correct: z.boolean(),
        user_correction_notes: z.string().nullable().optional(),
        corrected_doenca_id: z.string().uuid().nullable().optional(),
      })
    )
    .min(1)
    .max(50),
});

export const syncSlmLogsSchema = z.object({
  slm_sessions: z
    .array(
      z.object({
        session_id: z.string().uuid(),
        started_at: z.string(),
        ended_at: z.string().optional(),
        model_version: z.string().min(1),
        interactions: z.array(
          z.object({
            prompt: z.string(),
            response: z.string(),
            latency_ms: z.number().int(),
            rag_used_documents: z.array(z.unknown()).default([]),
          })
        ),
      })
    )
    .min(1)
    .max(20),
});

export type SyncDiagnosticsInput = z.infer<typeof syncDiagnosticsSchema>;
export type SyncFeedbackInput = z.infer<typeof syncFeedbackSchema>;
export type SyncSlmLogsInput = z.infer<typeof syncSlmLogsSchema>;
```

`backend/src/modules/sync/sync.service.ts` (nesta task só `syncDiagnostics`; os outros métodos entram nas Tasks 4 e 5):

```ts
import { and, eq } from 'drizzle-orm';
import { db } from '../../db';
import { diagnosticos, doencas, feedbacksDiagnostico } from '../../db/schema';
import { SyncDiagnosticsInput } from './sync.schema';

interface SyncedItem { local_id: string; server_id: string }
interface FailedItem { local_id: string; error_code: string; message: string }

export class SyncService {
  async syncDiagnostics(userId: string, input: SyncDiagnosticsInput) {
    const synced_items: SyncedItem[] = [];
    const failed_items: FailedItem[] = [];

    for (const item of input.diagnostics) {
      try {
        // Dedup por mobile_local_id (idempotente)
        const existing = await db.query.diagnosticos.findFirst({
          where: eq(diagnosticos.mobileLocalId, item.local_id),
        });
        if (existing) {
          synced_items.push({ local_id: item.local_id, server_id: existing.id });
          continue;
        }

        const doenca = await db.query.doencas.findFirst({
          where: eq(doencas.id, item.ai_result.doenca_id),
        });
        if (!doenca) {
          failed_items.push({
            local_id: item.local_id,
            error_code: 'INVALID_DOENCA_ID',
            message: 'O doenca_id informado não existe no catálogo.',
          });
          continue;
        }

        const [inserted] = await db
          .insert(diagnosticos)
          .values({
            userId,
            mobileLocalId: item.local_id,
            imageS3Key: item.image_s3_key,
            latitude: item.location.lat,
            longitude: item.location.lng,
            doencaId: item.ai_result.doenca_id,
            confiancaIa: item.ai_result.confianca,
            modeloUsado: item.ai_result.modelo_usado,
            tempoInferenciaMs: item.ai_result.tempo_inferencia_ms,
            // Diagnóstico feito offline: cross-validation não ocorreu (Contratos §9)
            crossValidationStatus: 'SKIPPED',
            capturedAt: new Date(item.timestamp),
          })
          .returning({ id: diagnosticos.id });

        // Vincula feedbacks que chegaram antes do diagnóstico (T5.4)
        await db
          .update(feedbacksDiagnostico)
          .set({ diagnosticoId: inserted.id, status: 'PROCESSED' })
          .where(
            and(
              eq(feedbacksDiagnostico.mobileLocalId, item.local_id),
              eq(feedbacksDiagnostico.userId, userId),
              eq(feedbacksDiagnostico.status, 'PENDING_DIAGNOSTIC')
            )
          );

        synced_items.push({ local_id: item.local_id, server_id: inserted.id });
      } catch (err) {
        failed_items.push({
          local_id: item.local_id,
          error_code: 'SYNC_ITEM_ERROR',
          message: err instanceof Error ? err.message : 'Erro desconhecido ao persistir item.',
        });
      }
    }

    return {
      status: failed_items.length === 0 ? 'success' : 'partial',
      synced_count: synced_items.length,
      failed_count: failed_items.length,
      synced_items,
      failed_items,
    };
  }
}

export const syncService = new SyncService();
```

`backend/src/modules/sync/sync.controller.ts`:

```ts
import { FastifyRequest, FastifyReply } from 'fastify';
import { syncDiagnosticsSchema } from './sync.schema';
import { syncService } from './sync.service';

export const syncController = {
  async diagnostics(request: FastifyRequest, reply: FastifyReply) {
    const body = syncDiagnosticsSchema.parse(request.body);
    const user = request.user as { sub: string };
    const result = await syncService.syncDiagnostics(user.sub, body);
    return reply.code(200).send(result);
  },
};
```

`backend/src/modules/sync/sync.routes.ts`:

```ts
import { FastifyInstance } from 'fastify';
import { syncController } from './sync.controller';
import { authenticate } from '../../plugins/authenticate';

export async function syncRoutes(fastify: FastifyInstance) {
  fastify.post('/diagnostics', { preHandler: [authenticate] }, syncController.diagnostics);
}

export default syncRoutes;
```

Em `backend/src/app.ts` (rate limit do contrato: 30/min para `/sync/*`):

```ts
import syncRoutes from './modules/sync/sync.routes';
// ...
app.register(syncRoutes, {
  prefix: '/api/v1/sync',
  config: {
    rateLimit: {
      max: 30,
      timeWindow: '1 minute',
    },
  },
});
```

- [ ] **Step 4: Rodar testes**

Run: `cd backend && npx vitest run src/modules/sync/sync.diagnostics.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/sync backend/src/app.ts
git commit -m "feat(backend): add batch diagnostics sync endpoint with dedup by mobile_local_id"
```

---

## Task 4: Backend — `POST /sync/feedback` (PENDING_DIAGNOSTIC + dedup)

**Files:**
- Modify: `backend/src/modules/sync/sync.service.ts`
- Modify: `backend/src/modules/sync/sync.controller.ts`
- Modify: `backend/src/modules/sync/sync.routes.ts`
- Test: `backend/src/modules/sync/sync.feedback.test.ts`

- [ ] **Step 1: Escrever o teste (falha)**

`backend/src/modules/sync/sync.feedback.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { app } from '../../app';
import { db } from '../../db';
import {
  usuarios, refreshTokens, culturas, doencas, diagnosticos, feedbacksDiagnostico,
} from '../../db/schema';

const culturaId = `cultura-test-${randomUUID()}`;
let doencaId: string;
let accessToken: string;

describe('POST /api/v1/sync/feedback (integration)', () => {
  beforeAll(async () => {
    await app.ready();
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { nome: 'Feedback Tester', email: 'sync-fb@test.com', password: 'senha123!' },
    });
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'sync-fb@test.com', password: 'senha123!' },
    });
    accessToken = JSON.parse(loginRes.body).access_token;

    await db.insert(culturas).values({ id: culturaId, nome: 'Soja Teste FB', estagioFenologicoPadrao: [] });
    const [d] = await db
      .insert(doencas)
      .values({ idCultura: culturaId, nomeComum: 'Doenca FB Teste', sintomas: 'manchas' })
      .returning({ id: doencas.id });
    doencaId = d.id;
  });

  afterAll(async () => {
    await db.delete(feedbacksDiagnostico);
    await db.delete(diagnosticos);
    await db.delete(doencas).where(eq(doencas.id, doencaId));
    await db.delete(culturas).where(eq(culturas.id, culturaId));
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.close();
  });

  function makeFeedback(diagnosticLocalId: string) {
    return {
      diagnostic_server_id: null,
      diagnostic_local_id: diagnosticLocalId,
      timestamp_feedback: '2026-06-10T08:35:00Z',
      is_correct: false,
      user_correction_notes: 'Não era ferrugem.',
      corrected_doenca_id: null,
    };
  }

  it('aceita feedback antes do diagnóstico como PENDING_DIAGNOSTIC (T5.4)', async () => {
    const localId = randomUUID();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/feedback',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { feedbacks: [makeFeedback(localId)] },
    });
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('success');
    expect(body.processed_count).toBe(1);
    expect(body.processed_items[0].feedback_id).toBeTruthy();

    const [row] = await db
      .select()
      .from(feedbacksDiagnostico)
      .where(eq(feedbacksDiagnostico.mobileLocalId, localId));
    expect(row.status).toBe('PENDING_DIAGNOSTIC');
    expect(row.diagnosticoId).toBeNull();

    // Quando o diagnóstico chega depois, o feedback é vinculado retroativamente
    const diagRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/diagnostics',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {
        diagnostics: [{
          local_id: localId,
          timestamp: '2026-06-10T08:30:00Z',
          image_s3_key: `diagnosticos/test/${localId}.jpg`,
          location: { lat: -23.5, lng: -46.6 },
          ai_result: { doenca_id: doencaId, confianca: 0.9, modelo_usado: 'tflite_v1.0', tempo_inferencia_ms: 40 },
        }],
      },
    });
    const serverId = JSON.parse(diagRes.body).synced_items[0].server_id;

    const [linked] = await db
      .select()
      .from(feedbacksDiagnostico)
      .where(eq(feedbacksDiagnostico.mobileLocalId, localId));
    expect(linked.status).toBe('PROCESSED');
    expect(linked.diagnosticoId).toBe(serverId);
  });

  it('vincula imediatamente quando o diagnóstico já existe', async () => {
    const localId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/api/v1/sync/diagnostics',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {
        diagnostics: [{
          local_id: localId,
          timestamp: '2026-06-10T08:30:00Z',
          image_s3_key: `diagnosticos/test/${localId}.jpg`,
          location: { lat: -23.5, lng: -46.6 },
          ai_result: { doenca_id: doencaId, confianca: 0.9, modelo_usado: 'tflite_v1.0', tempo_inferencia_ms: 40 },
        }],
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/feedback',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { feedbacks: [makeFeedback(localId)] },
    });
    expect(res.statusCode).toBe(202);

    const [row] = await db
      .select()
      .from(feedbacksDiagnostico)
      .where(eq(feedbacksDiagnostico.mobileLocalId, localId));
    expect(row.status).toBe('PROCESSED');
    expect(row.diagnosticoId).not.toBeNull();
  });

  it('é idempotente: reenvio do mesmo feedback não duplica', async () => {
    const localId = randomUUID();
    const payload = { feedbacks: [makeFeedback(localId)] };
    const first = await app.inject({
      method: 'POST', url: '/api/v1/sync/feedback',
      headers: { Authorization: `Bearer ${accessToken}` }, payload,
    });
    const second = await app.inject({
      method: 'POST', url: '/api/v1/sync/feedback',
      headers: { Authorization: `Bearer ${accessToken}` }, payload,
    });
    expect(JSON.parse(second.body).processed_items[0].feedback_id)
      .toBe(JSON.parse(first.body).processed_items[0].feedback_id);

    const rows = await db
      .select()
      .from(feedbacksDiagnostico)
      .where(eq(feedbacksDiagnostico.mobileLocalId, localId));
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar para confirmar falha**

Run: `cd backend && npx vitest run src/modules/sync/sync.feedback.test.ts`
Expected: FAIL — rota `/sync/feedback` 404.

- [ ] **Step 3: Implementar**

Adicionar ao `SyncService` (`sync.service.ts`) — novos imports: `SyncFeedbackInput` de `./sync.schema`:

```ts
  async syncFeedback(userId: string, input: SyncFeedbackInput) {
    const processed_items: Array<{ diagnostic_local_id: string; feedback_id: string }> = [];
    const failed_items: Array<{ diagnostic_local_id: string; error_code: string; message: string }> = [];

    for (const fb of input.feedbacks) {
      try {
        // Dedup: um feedback por diagnóstico por usuário
        const existing = await db.query.feedbacksDiagnostico.findFirst({
          where: and(
            eq(feedbacksDiagnostico.userId, userId),
            eq(feedbacksDiagnostico.mobileLocalId, fb.diagnostic_local_id)
          ),
        });
        if (existing) {
          processed_items.push({ diagnostic_local_id: fb.diagnostic_local_id, feedback_id: existing.id });
          continue;
        }

        if (fb.corrected_doenca_id) {
          const doenca = await db.query.doencas.findFirst({
            where: eq(doencas.id, fb.corrected_doenca_id),
          });
          if (!doenca) {
            failed_items.push({
              diagnostic_local_id: fb.diagnostic_local_id,
              error_code: 'INVALID_DOENCA_ID',
              message: 'O corrected_doenca_id informado não existe no catálogo.',
            });
            continue;
          }
        }

        const diagnostic = await db.query.diagnosticos.findFirst({
          where: and(
            eq(diagnosticos.userId, userId),
            eq(diagnosticos.mobileLocalId, fb.diagnostic_local_id)
          ),
        });

        const [inserted] = await db
          .insert(feedbacksDiagnostico)
          .values({
            userId,
            diagnosticoId: diagnostic?.id ?? null,
            mobileLocalId: fb.diagnostic_local_id,
            status: diagnostic ? 'PROCESSED' : 'PENDING_DIAGNOSTIC',
            isCorrect: fb.is_correct,
            correctedDoencaId: fb.corrected_doenca_id ?? null,
            userCorrectionNotes: fb.user_correction_notes ?? null,
            feedbackAt: new Date(fb.timestamp_feedback),
          })
          .returning({ id: feedbacksDiagnostico.id });

        processed_items.push({ diagnostic_local_id: fb.diagnostic_local_id, feedback_id: inserted.id });
      } catch (err) {
        failed_items.push({
          diagnostic_local_id: fb.diagnostic_local_id,
          error_code: 'SYNC_ITEM_ERROR',
          message: err instanceof Error ? err.message : 'Erro desconhecido ao persistir feedback.',
        });
      }
    }

    return {
      status: failed_items.length === 0 ? 'success' : 'partial',
      processed_count: processed_items.length,
      failed_count: failed_items.length,
      processed_items,
      failed_items,
    };
  }
```

Adicionar ao controller:

```ts
  async feedback(request: FastifyRequest, reply: FastifyReply) {
    const body = syncFeedbackSchema.parse(request.body);
    const user = request.user as { sub: string };
    const result = await syncService.syncFeedback(user.sub, body);
    return reply.code(202).send(result);
  },
```

Adicionar à rota:

```ts
  fastify.post('/feedback', { preHandler: [authenticate] }, syncController.feedback);
```

- [ ] **Step 4: Rodar testes**

Run: `cd backend && npx vitest run src/modules/sync/sync.feedback.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/sync
git commit -m "feat(backend): add feedback sync endpoint with PENDING_DIAGNOSTIC support"
```

---

## Task 5: Backend — `POST /sync/slm-logs`

**Files:**
- Modify: `backend/src/modules/sync/sync.service.ts`
- Modify: `backend/src/modules/sync/sync.controller.ts`
- Modify: `backend/src/modules/sync/sync.routes.ts`
- Test: `backend/src/modules/sync/sync.slmlogs.test.ts`

- [ ] **Step 1: Escrever o teste (falha)**

`backend/src/modules/sync/sync.slmlogs.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { app } from '../../app';
import { db } from '../../db';
import { usuarios, refreshTokens, sessoesSlm, interacoesSlm } from '../../db/schema';

let accessToken: string;

describe('POST /api/v1/sync/slm-logs (integration)', () => {
  beforeAll(async () => {
    await app.ready();
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { nome: 'SLM Tester', email: 'sync-slm@test.com', password: 'senha123!' },
    });
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'sync-slm@test.com', password: 'senha123!' },
    });
    accessToken = JSON.parse(loginRes.body).access_token;
  });

  afterAll(async () => {
    await db.delete(interacoesSlm);
    await db.delete(sessoesSlm);
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.close();
  });

  it('persiste sessão e interações (T5.5)', async () => {
    const sessionId = randomUUID();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/slm-logs',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {
        slm_sessions: [{
          session_id: sessionId,
          started_at: '2026-06-09T14:00:00Z',
          model_version: 'gemma-2b-it-q4_k_m',
          interactions: [
            { prompt: 'Como aplico fungicida?', response: 'Recomenda-se...', latency_ms: 3200, rag_used_documents: [] },
            { prompt: 'E na chuva?', response: 'Evite aplicar...', latency_ms: 2800, rag_used_documents: [] },
          ],
        }],
      },
    });
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('success');
    expect(body.processed_count).toBe(1);

    const [session] = await db.select().from(sessoesSlm).where(eq(sessoesSlm.mobileSessionId, sessionId));
    expect(session).toBeTruthy();
    const interactions = await db.select().from(interacoesSlm).where(eq(interacoesSlm.sessaoId, session.id));
    expect(interactions).toHaveLength(2);
  });

  it('é idempotente por mobile_session_id', async () => {
    const sessionId = randomUUID();
    const payload = {
      slm_sessions: [{
        session_id: sessionId,
        started_at: '2026-06-09T15:00:00Z',
        model_version: 'gemma-2b-it-q4_k_m',
        interactions: [{ prompt: 'Oi', response: 'Olá!', latency_ms: 1000, rag_used_documents: [] }],
      }],
    };
    await app.inject({
      method: 'POST', url: '/api/v1/sync/slm-logs',
      headers: { Authorization: `Bearer ${accessToken}` }, payload,
    });
    const second = await app.inject({
      method: 'POST', url: '/api/v1/sync/slm-logs',
      headers: { Authorization: `Bearer ${accessToken}` }, payload,
    });
    expect(second.statusCode).toBe(202);

    const sessions = await db.select().from(sessoesSlm).where(eq(sessoesSlm.mobileSessionId, sessionId));
    expect(sessions).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar para confirmar falha**

Run: `cd backend && npx vitest run src/modules/sync/sync.slmlogs.test.ts`
Expected: FAIL — rota 404.

- [ ] **Step 3: Implementar**

Adicionar ao `SyncService` (imports: `SyncSlmLogsInput`, `sessoesSlm`, `interacoesSlm`):

```ts
  async syncSlmLogs(userId: string, input: SyncSlmLogsInput) {
    let processed_count = 0;

    for (const session of input.slm_sessions) {
      const existing = await db.query.sessoesSlm.findFirst({
        where: and(
          eq(sessoesSlm.userId, userId),
          eq(sessoesSlm.mobileSessionId, session.session_id)
        ),
      });
      if (existing) {
        processed_count += 1;
        continue;
      }

      const [inserted] = await db
        .insert(sessoesSlm)
        .values({
          userId,
          mobileSessionId: session.session_id,
          modelVersion: session.model_version,
          startedAt: new Date(session.started_at),
          // Contrato não envia ended_at; usa started_at como fallback
          endedAt: new Date(session.ended_at ?? session.started_at),
        })
        .returning({ id: sessoesSlm.id });

      if (session.interactions.length > 0) {
        await db.insert(interacoesSlm).values(
          session.interactions.map((i) => ({
            sessaoId: inserted.id,
            prompt: i.prompt,
            response: i.response,
            latencyMs: i.latency_ms,
            ragUsedDocuments: i.rag_used_documents ?? [],
          }))
        );
      }
      processed_count += 1;
    }

    return { status: 'success', processed_count };
  }
```

Controller:

```ts
  async slmLogs(request: FastifyRequest, reply: FastifyReply) {
    const body = syncSlmLogsSchema.parse(request.body);
    const user = request.user as { sub: string };
    const result = await syncService.syncSlmLogs(user.sub, body);
    return reply.code(202).send(result);
  },
```

Rota:

```ts
  fastify.post('/slm-logs', { preHandler: [authenticate] }, syncController.slmLogs);
```

- [ ] **Step 4: Rodar testes**

Run: `cd backend && npx vitest run src/modules/sync`
Expected: PASS (todos os arquivos de sync).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/sync
git commit -m "feat(backend): add SLM session logs sync endpoint"
```

---

## Task 6: Backend — `GET /catalog/sync` (ETag + cursor pagination)

**Files:**
- Create: `backend/src/modules/catalog/catalog.service.ts`
- Create: `backend/src/modules/catalog/catalog.controller.ts`
- Create: `backend/src/modules/catalog/catalog.routes.ts`
- Test: `backend/src/modules/catalog/catalog.test.ts`
- Modify: `backend/src/app.ts`

**Design do ETag (da spec):** string `"{maxUpdatedAtISO}|{sha256-16hex}"`, opaca para o cliente. O hash cobre `count` + `max(updated_at)` das 4 tabelas. O servidor extrai o timestamp do ETag do cliente para calcular o delta (`updated_at > since`). O cursor é base64url de `{since, table, u, id}` — preserva o `since` da primeira página para consistência entre páginas.

- [ ] **Step 1: Escrever o teste (falha)**

`backend/src/modules/catalog/catalog.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { app } from '../../app';
import { db } from '../../db';
import { usuarios, refreshTokens, culturas, doencas } from '../../db/schema';

const culturaId = `cultura-test-${randomUUID()}`;
let doencaId: string;
let accessToken: string;

async function callSync(query: string = '', etag?: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/catalog/sync${query}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(etag ? { 'If-None-Match': etag } : {}),
    },
  });
}

describe('GET /api/v1/catalog/sync (integration)', () => {
  beforeAll(async () => {
    await app.ready();
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { nome: 'Catalog Tester', email: 'catalog@test.com', password: 'senha123!' },
    });
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'catalog@test.com', password: 'senha123!' },
    });
    accessToken = JSON.parse(loginRes.body).access_token;

    await db.insert(culturas).values({ id: culturaId, nome: 'Cultura Catalog', estagioFenologicoPadrao: [] });
    const [d] = await db
      .insert(doencas)
      .values({ idCultura: culturaId, nomeComum: 'Doenca Catalog v1', sintomas: 'sintoma inicial' })
      .returning({ id: doencas.id });
    doencaId = d.id;
  });

  afterAll(async () => {
    await db.delete(doencas).where(eq(doencas.id, doencaId));
    await db.delete(culturas).where(eq(culturas.id, culturaId));
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.close();
  });

  it('sem ETag retorna catálogo completo com catalog_version_hash', async () => {
    const res = await callSync('?limit=500');
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.catalog_version_hash).toBeTruthy();
    expect(body.has_more).toBe(false);
    const doencaIds = body.updates.doencas.map((u: any) => u.action === 'upsert' ? u.data.id : u.id);
    expect(doencaIds).toContain(doencaId);
  });

  it('retorna 304 quando ETag é igual (T5.7)', async () => {
    const first = await callSync('?limit=500');
    const etag = JSON.parse(first.body).catalog_version_hash;
    const second = await callSync('?limit=500', etag);
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe('');
  });

  it('detecta alteração e retorna delta (T5.6)', async () => {
    const first = await callSync('?limit=500');
    const oldEtag = JSON.parse(first.body).catalog_version_hash;

    await db
      .update(doencas)
      .set({ nomeComum: 'Doenca Catalog v2', updatedAt: new Date() })
      .where(eq(doencas.id, doencaId));

    const res = await callSync('?limit=500', oldEtag);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.catalog_version_hash).not.toBe(oldEtag);
    const changed = body.updates.doencas.find((u: any) => u.action === 'upsert' && u.data.id === doencaId);
    expect(changed).toBeTruthy();
    expect(changed.data.nome_comum).toBe('Doenca Catalog v2');
  });

  it('soft delete vira action delete', async () => {
    const first = await callSync('?limit=500');
    const oldEtag = JSON.parse(first.body).catalog_version_hash;

    await db
      .update(doencas)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(doencas.id, doencaId));

    const res = await callSync('?limit=500', oldEtag);
    const body = JSON.parse(res.body);
    const deleted = body.updates.doencas.find((u: any) => u.action === 'delete' && u.id === doencaId);
    expect(deleted).toBeTruthy();

    // restaura para os demais testes
    await db.update(doencas).set({ isActive: true, updatedAt: new Date() }).where(eq(doencas.id, doencaId));
  });

  it('pagina com cursor e has_more', async () => {
    // catálogo completo tem 15+ doenças do seed; limit=2 força paginação
    let res = await callSync('?limit=2');
    let body = JSON.parse(res.body);
    expect(body.has_more).toBe(true);
    expect(body.next_cursor).toBeTruthy();

    const collected: string[] = [];
    const collect = (b: any) => {
      for (const tableName of ['culturas', 'doencas', 'defensivos', 'doenca_defensivo']) {
        for (const u of b.updates[tableName] ?? []) {
          collected.push(`${tableName}:${u.action === 'upsert' ? JSON.stringify(u.data) : u.id}`);
        }
      }
    };
    collect(body);

    let guard = 0;
    while (body.has_more && guard < 200) {
      res = await callSync(`?limit=2&cursor=${encodeURIComponent(body.next_cursor)}`);
      body = JSON.parse(res.body);
      collect(body);
      guard += 1;
    }
    expect(body.has_more).toBe(false);

    // mesma quantidade de itens que a versão sem paginação
    const full = await callSync('?limit=500');
    const fullBody = JSON.parse(full.body);
    let fullCount = 0;
    for (const t of ['culturas', 'doencas', 'defensivos', 'doenca_defensivo']) {
      fullCount += (fullBody.updates[t] ?? []).length;
    }
    expect(collected.length).toBe(fullCount);
  });
});
```

- [ ] **Step 2: Rodar para confirmar falha**

Run: `cd backend && npx vitest run src/modules/catalog`
Expected: FAIL — rota 404.

- [ ] **Step 3: Implementar o service**

`backend/src/modules/catalog/catalog.service.ts`:

```ts
import { createHash } from 'crypto';
import { and, asc, count, eq, gt, max, or, SQL } from 'drizzle-orm';
import { PgColumn } from 'drizzle-orm/pg-core';
import { db } from '../../db';
import { culturas, doencas, defensivos, doencaDefensivo } from '../../db/schema';

const EPOCH_ISO = new Date(0).toISOString();
const TABLES = ['culturas', 'doencas', 'defensivos', 'doenca_defensivo'] as const;

export type UpdateEntry =
  | { action: 'upsert'; data: Record<string, unknown> }
  | { action: 'delete'; id: string };

interface RowWithPos { entry: UpdateEntry; u: string; id: string }
interface CursorPos { since: string; table: number; u: string | null; id: string | null }

function encodeCursor(pos: CursorPos): string {
  return Buffer.from(JSON.stringify(pos)).toString('base64url');
}

function decodeCursor(raw: string): CursorPos | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed.since !== 'string' || typeof parsed.table !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parseEtagSince(etag: string | undefined): string {
  if (!etag) return EPOCH_ISO;
  const sep = etag.lastIndexOf('|');
  if (sep === -1) return EPOCH_ISO;
  const ts = etag.slice(0, sep);
  return Number.isNaN(Date.parse(ts)) ? EPOCH_ISO : ts;
}

export async function computeCatalogEtag(): Promise<string> {
  const stats = await Promise.all([
    db.select({ total: count(), latest: max(culturas.updatedAt) }).from(culturas),
    db.select({ total: count(), latest: max(doencas.updatedAt) }).from(doencas),
    db.select({ total: count(), latest: max(defensivos.updatedAt) }).from(defensivos),
    db.select({ total: count(), latest: max(doencaDefensivo.updatedAt) }).from(doencaDefensivo),
  ]);

  const parts: string[] = [];
  let maxUpdated = new Date(0);
  for (const [row] of stats) {
    const latest = row.latest ?? new Date(0);
    if (latest > maxUpdated) maxUpdated = latest;
    parts.push(`${row.total}:${latest.toISOString()}`);
  }
  const hash = createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
  return `${maxUpdated.toISOString()}|${hash}`;
}

// Condição de delta: updated_at > since; com cursor, retoma após (u, id)
function deltaCondition(
  updatedAtCol: PgColumn,
  idCol: PgColumn,
  since: string,
  after: { u: string; id: string } | null
): SQL | undefined {
  if (!after) return gt(updatedAtCol, new Date(since));
  const afterDate = new Date(after.u);
  return or(
    gt(updatedAtCol, afterDate),
    and(eq(updatedAtCol, afterDate), gt(idCol, after.id))
  );
}

type Fetcher = (since: string, after: { u: string; id: string } | null, limit: number) => Promise<RowWithPos[]>;

const fetchCulturas: Fetcher = async (since, after, limit) => {
  const rows = await db.select().from(culturas)
    .where(deltaCondition(culturas.updatedAt, culturas.id, since, after))
    .orderBy(asc(culturas.updatedAt), asc(culturas.id))
    .limit(limit);
  return rows.map((r) => ({
    u: r.updatedAt.toISOString(),
    id: r.id,
    entry: r.isActive
      ? { action: 'upsert' as const, data: { id: r.id, nome: r.nome, estagio_fenologico_padrao: r.estagioFenologicoPadrao } }
      : { action: 'delete' as const, id: r.id },
  }));
};

const fetchDoencas: Fetcher = async (since, after, limit) => {
  const rows = await db.select().from(doencas)
    .where(deltaCondition(doencas.updatedAt, doencas.id, since, after))
    .orderBy(asc(doencas.updatedAt), asc(doencas.id))
    .limit(limit);
  return rows.map((r) => ({
    u: r.updatedAt.toISOString(),
    id: r.id,
    entry: r.isActive
      ? {
          action: 'upsert' as const,
          data: {
            id: r.id,
            id_cultura: r.idCultura,
            nome_comum: r.nomeComum,
            nome_cientifico: r.nomeCientifico,
            sintomas: r.sintomas,
            nivel_severidade: r.nivelSeveridade,
          },
        }
      : { action: 'delete' as const, id: r.id },
  }));
};

const fetchDefensivos: Fetcher = async (since, after, limit) => {
  const rows = await db.select().from(defensivos)
    .where(deltaCondition(defensivos.updatedAt, defensivos.id, since, after))
    .orderBy(asc(defensivos.updatedAt), asc(defensivos.id))
    .limit(limit);
  return rows.map((r) => ({
    u: r.updatedAt.toISOString(),
    id: r.id,
    entry: r.isActive
      ? {
          action: 'upsert' as const,
          data: {
            id: r.id,
            nome_comercial: r.nomeComercial,
            ingrediente_ativo: r.ingredienteAtivo,
            fabricante: r.fabricante,
            classe: r.classe,
            grupo_quimico_frac: r.grupoQuimicoFrac,
            bula_resumida: r.bulaResumida,
          },
        }
      : { action: 'delete' as const, id: r.id },
  }));
};

// doenca_defensivo: apenas upsert no MVP (sem soft delete no schema)
const fetchDoencaDefensivo: Fetcher = async (since, after, limit) => {
  const rows = await db.select().from(doencaDefensivo)
    .where(deltaCondition(doencaDefensivo.updatedAt, doencaDefensivo.id, since, after))
    .orderBy(asc(doencaDefensivo.updatedAt), asc(doencaDefensivo.id))
    .limit(limit);
  return rows.map((r) => ({
    u: r.updatedAt.toISOString(),
    id: r.id,
    entry: {
      action: 'upsert' as const,
      data: {
        id_doenca: r.idDoenca,
        id_defensivo: r.idDefensivo,
        dosagem_recomendada: r.dosagemRecomendada,
        carencia_dias: r.carenciaDias,
        max_aplicacoes_ciclo: r.maxAplicacoesCiclo,
      },
    },
  }));
};

const FETCHERS: Fetcher[] = [fetchCulturas, fetchDoencas, fetchDefensivos, fetchDoencaDefensivo];

export async function getCatalogDelta(clientEtag: string | undefined, cursorRaw: string | undefined, limit: number) {
  const currentEtag = await computeCatalogEtag();

  if (!cursorRaw && clientEtag && clientEtag === currentEtag) {
    return { notModified: true as const, etag: currentEtag };
  }

  const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
  const since = cursor ? cursor.since : parseEtagSince(clientEtag);
  let tableIdx = cursor ? cursor.table : 0;
  let after = cursor && cursor.u && cursor.id ? { u: cursor.u, id: cursor.id } : null;

  const updates: Record<(typeof TABLES)[number], UpdateEntry[]> = {
    culturas: [], doencas: [], defensivos: [], doenca_defensivo: [],
  };

  let remaining = limit;
  let hasMore = false;
  let nextCursor: string | null = null;

  for (; tableIdx < TABLES.length; tableIdx++) {
    // busca remaining+1 para detectar se há mais itens sem segunda query
    const batch = await FETCHERS[tableIdx](since, after, remaining + 1);
    const included = batch.slice(0, remaining);
    for (const row of included) updates[TABLES[tableIdx]].push(row.entry);
    remaining -= included.length;

    if (batch.length > included.length) {
      const last = included[included.length - 1];
      hasMore = true;
      nextCursor = encodeCursor(
        last
          ? { since, table: tableIdx, u: last.u, id: last.id }
          : { since, table: tableIdx, u: after?.u ?? null, id: after?.id ?? null }
      );
      break;
    }
    after = null; // próxima tabela começa do início
  }

  return {
    notModified: false as const,
    etag: currentEtag,
    updates,
    has_more: hasMore,
    next_cursor: nextCursor,
  };
}
```

- [ ] **Step 4: Implementar controller, rotas e registro**

`backend/src/modules/catalog/catalog.controller.ts`:

```ts
import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getCatalogDelta } from './catalog.service';

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const catalogController = {
  async sync(request: FastifyRequest, reply: FastifyReply) {
    const { cursor, limit } = querySchema.parse(request.query);
    const rawEtag = request.headers['if-none-match'] as string | undefined;
    // tolera ETags com aspas/W/ enviados por proxies
    const clientEtag = rawEtag?.replace(/^W\//, '').replace(/"/g, '');

    const result = await getCatalogDelta(clientEtag, cursor, limit);

    if (result.notModified) {
      return reply.code(304).header('etag', `"${result.etag}"`).send();
    }

    return reply.header('etag', `"${result.etag}"`).send({
      catalog_version_hash: result.etag,
      next_cursor: result.next_cursor,
      has_more: result.has_more,
      updates: result.updates,
    });
  },
};
```

`backend/src/modules/catalog/catalog.routes.ts`:

```ts
import { FastifyInstance } from 'fastify';
import { catalogController } from './catalog.controller';
import { authenticate } from '../../plugins/authenticate';

export async function catalogRoutes(fastify: FastifyInstance) {
  fastify.get('/sync', { preHandler: [authenticate] }, catalogController.sync);
}

export default catalogRoutes;
```

Em `backend/src/app.ts` (rate limit do contrato: 60/min para `/catalog/*`):

```ts
import catalogRoutes from './modules/catalog/catalog.routes';
// ...
app.register(catalogRoutes, {
  prefix: '/api/v1/catalog',
  config: {
    rateLimit: {
      max: 60,
      timeWindow: '1 minute',
    },
  },
});
```

- [ ] **Step 5: Rodar testes**

Run: `cd backend && npx vitest run src/modules/catalog`
Expected: PASS (5 testes).

> NOTA: o teste de paginação faz ~30 requests; o rate limit de 60/min pode estourar se a suíte rodar repetidamente em < 1 min. Se isso acontecer, suba `max` apenas em `NODE_ENV === 'test'` ou aguarde a janela.

- [ ] **Step 6: Rodar a suíte inteira do backend**

Run: `cd backend && npx vitest run`
Expected: PASS em todos os módulos.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/catalog backend/src/app.ts
git commit -m "feat(backend): add catalog delta sync endpoint with ETag and cursor pagination"
```

---

## Task 7: Frontend — SQLite v4 (`sync_metadata`) + handlers genéricos no WebDatabaseDriver

**Files:**
- Modify: `frontend/db/sqlite.ts`
- Test: `frontend/db/sqliteSync.test.ts`

A migração v4 cria `sync_metadata`. O `WebDatabaseDriver` (mock web) ganha handlers **genéricos** de INSERT/UPDATE/DELETE baseados em parsing das colunas — substituindo os branches hardcoded por tabela — para suportar os novos statements do sync sem caso especial por query.

- [ ] **Step 1: Escrever os testes (falham)**

`frontend/db/sqliteSync.test.ts`:

```ts
import './../store/test-globals';
import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-secure-store', () => ({
  setItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import { dbDriver, getSyncMeta, setSyncMeta } from './sqlite';

describe('sync_metadata helpers (WebDatabaseDriver)', () => {
  it('retorna null para chave inexistente', async () => {
    expect(await getSyncMeta('chave-que-nao-existe')).toBeNull();
  });

  it('grava e lê valor; INSERT OR REPLACE sobrescreve', async () => {
    await setSyncMeta('catalog_etag', 'v1|abc');
    expect(await getSyncMeta('catalog_etag')).toBe('v1|abc');
    await setSyncMeta('catalog_etag', 'v2|def');
    expect(await getSyncMeta('catalog_etag')).toBe('v2|def');
  });
});

describe('WebDatabaseDriver generic handlers', () => {
  it('UPDATE genérico altera colunas pelo nome', async () => {
    await dbDriver.execute(
      `INSERT INTO fila_diagnosticos (local_id, server_id, image_uri, image_s3_key, latitude, longitude, doenca_id, confianca_ia, modelo_usado, tempo_inferencia_ms, sync_status, retry_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      ['gen-1', null, 'file:///a.jpg', null, -23.5, -46.6, 'd1', 0.9, 'tflite_v1.0', 40, 'PENDING', 0]
    );

    await dbDriver.execute(
      'UPDATE fila_diagnosticos SET sync_status = ?, retry_count = ? WHERE local_id = ?;',
      ['FAILED', 5, 'gen-1']
    );

    const res = await dbDriver.execute(
      'SELECT * FROM fila_diagnosticos WHERE sync_status = ?;', ['FAILED']
    );
    const row = res.rows._array.find((r: any) => r.local_id === 'gen-1');
    expect(row.retry_count).toBe(5);
  });

  it('UPDATE de image_s3_key funciona', async () => {
    await dbDriver.execute(
      'UPDATE fila_diagnosticos SET image_s3_key = ? WHERE local_id = ?;',
      ['diagnosticos/u/x.jpg', 'gen-1']
    );
    const res = await dbDriver.execute('SELECT * FROM fila_diagnosticos;');
    const row = res.rows._array.find((r: any) => r.local_id === 'gen-1');
    expect(row.image_s3_key).toBe('diagnosticos/u/x.jpg');
  });

  it('DELETE genérico com chave remove a linha', async () => {
    await dbDriver.execute('DELETE FROM fila_diagnosticos WHERE local_id = ?;', ['gen-1']);
    const res = await dbDriver.execute('SELECT * FROM fila_diagnosticos;');
    expect(res.rows._array.find((r: any) => r.local_id === 'gen-1')).toBeUndefined();
  });

  it('INSERT OR REPLACE em tabela de catálogo faz upsert pela primeira coluna', async () => {
    await dbDriver.execute(
      'INSERT OR REPLACE INTO doencas (id, id_cultura, nome_comum, nome_cientifico, sintomas, nivel_severidade, causa) VALUES (?, ?, ?, ?, ?, ?, ?);',
      ['up-1', 'cultura-soja-id', 'Nova Doenca', 'Fungus novus', 'manchas', 3, 'Fungo (Fungus novus)']
    );
    await dbDriver.execute(
      'INSERT OR REPLACE INTO doencas (id, id_cultura, nome_comum, nome_cientifico, sintomas, nivel_severidade, causa) VALUES (?, ?, ?, ?, ?, ?, ?);',
      ['up-1', 'cultura-soja-id', 'Nova Doenca v2', 'Fungus novus', 'manchas', 3, 'Fungo (Fungus novus)']
    );
    const res = await dbDriver.execute('SELECT * FROM doencas WHERE id = ?;', ['up-1']);
    expect(res.rows.length).toBe(1);
    expect(res.rows.item(0).nome_comum).toBe('Nova Doenca v2');
  });

  it('SELECT em fila_slm_logs filtra por session_id', async () => {
    await dbDriver.execute(
      'INSERT INTO fila_slm_logs (session_id, started_at, model_version, interactions_json, sync_status, retry_count) VALUES (?, ?, ?, ?, ?, ?);',
      ['sess-1', '2026-06-10T10:00:00Z', 'gemma-2b-it-q4_k_m', '[]', 'PENDING', 0]
    );
    const res = await dbDriver.execute('SELECT * FROM fila_slm_logs WHERE session_id = ?;', ['sess-1']);
    expect(res.rows.length).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar para confirmar falha**

Run: `cd frontend && npx vitest run db/sqliteSync.test.ts`
Expected: FAIL — `getSyncMeta` não exportado; handlers genéricos inexistentes.

- [ ] **Step 3: Implementar em `frontend/db/sqlite.ts`**

**(a)** No `WebDatabaseDriver.tables`, adicionar `sync_metadata: []` após `fila_slm_logs: []`.

**(b)** No método `execute`, no branch `select * from`, adicionar após os filtros existentes:

```ts
      // Filtro por session_id (fila_slm_logs)
      if (sqlClean.includes('where session_id = ?')) {
        data = data.filter(d => d.session_id === params[0]);
      }
```

**(c)** Antes do branch `select * from`, adicionar handler para a leitura de metadados:

```ts
    // SELECT value FROM sync_metadata WHERE key = ?
    if (sqlClean.startsWith('select value from sync_metadata')) {
      const row = this.tables.sync_metadata.find((r) => r.key === params[0]);
      const arr = row ? [{ value: row.value }] : [];
      return {
        rows: { _array: arr, length: arr.length, item: (idx: number) => arr[idx] },
        rowsAffected: 0,
      };
    }
```

**(d)** **Substituir** o branch `2. INSERT INTO FILAS` inteiro (o bloco `if (sqlClean.startsWith('insert into'))`) por um parser genérico de colunas:

```ts
    // 2. INSERT (OR REPLACE) genérico — mapeia colunas declaradas para params; upsert pela 1ª coluna
    const insMatch = sqlClean.match(/^insert (?:or replace )?into (\w+)\s*\(([^)]+)\) values/);
    if (insMatch) {
      const tableName = insMatch[1];
      const cols = insMatch[2].split(',').map((c) => c.trim());
      const dataList = this.tables[tableName];
      if (dataList) {
        const rec: any = {};
        cols.forEach((c, i) => { rec[c] = params[i]; });
        // Defaults das filas (igual ao DDL nativo)
        if (!('timestamp' in rec) && (tableName === 'fila_diagnosticos' || tableName === 'fila_feedbacks')) {
          rec.timestamp = new Date().toISOString();
        }
        const keyCol = cols[0];
        const idx = dataList.findIndex((d) => d[keyCol] === rec[keyCol]);
        if (idx >= 0) {
          dataList[idx] = { ...dataList[idx], ...rec };
        } else {
          dataList.push(rec);
        }
        return {
          rows: { _array: [], length: 0, item: () => null },
          rowsAffected: 1,
          insertId: 1,
        };
      }
    }
```

**(e)** **Substituir** o branch `3. UPDATE FILAS` inteiro por um handler genérico:

```ts
    // 3. UPDATE genérico — todos os SETs do app usam apenas `col = ?` e WHERE de chave única
    const updMatch = sqlClean.match(/^update (\w+) set (.+?) where (\w+) = \?;?$/);
    if (updMatch) {
      const tableName = updMatch[1];
      const setCols = updMatch[2].split(',').map((s) => s.trim().split('=')[0].trim());
      const keyCol = updMatch[3];
      const dataList = this.tables[tableName];
      if (dataList) {
        const keyVal = params[params.length - 1];
        const item = dataList.find((d) => d[keyCol] === keyVal);
        if (item) {
          setCols.forEach((c, i) => { item[c] = params[i]; });
        }
        return {
          rows: { _array: [], length: 0, item: () => null },
          rowsAffected: item ? 1 : 0,
        };
      }
    }

    // 4. DELETE genérico (com ou sem WHERE de chave única)
    const delMatch = sqlClean.match(/^delete from (\w+)(?: where (\w+) = \?)?;?$/);
    if (delMatch) {
      const tableName = delMatch[1];
      const keyCol = delMatch[2];
      const dataList = this.tables[tableName];
      if (dataList) {
        if (keyCol) {
          this.tables[tableName] = dataList.filter((d) => d[keyCol] !== params[0]);
        } else {
          this.tables[tableName] = [];
        }
        return {
          rows: { _array: [], length: 0, item: () => null },
          rowsAffected: 1,
        };
      }
    }
```

> NOTA: o DELETE de cleanup (`... AND datetime(timestamp) < datetime(?)`) não casa com o regex e cai no retorno genérico vazio — aceitável no mock web.

**(f)** Na migração nativa (`runMigrationsAndSeed`), adicionar ao final, antes do fechamento da função:

```ts
  // v4: tabela de metadados de sincronização (catalog_etag, last_sync_at)
  if (version < 4) {
    console.log('[Database] Migrating to version 4: sync_metadata...');
    await driver.execute(`
      CREATE TABLE IF NOT EXISTS sync_metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
    await driver.execute('PRAGMA user_version = 4;');
  }
```

**(g)** Adicionar helpers exportados ao final de `sqlite.ts`:

```ts
// -------------------------------------------------------------
// Metadados de Sincronização (catalog_etag, last_sync_at)
// -------------------------------------------------------------
export async function getSyncMeta(key: string): Promise<string | null> {
  const res = await dbDriver.execute('SELECT value FROM sync_metadata WHERE key = ?;', [key]);
  return res.rows.length > 0 ? (res.rows.item(0).value ?? null) : null;
}

export async function setSyncMeta(key: string, value: string): Promise<void> {
  await dbDriver.execute('INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?);', [key, value]);
}
```

- [ ] **Step 4: Rodar os testes novos E os existentes (regressão do mock)**

Run: `cd frontend && npx vitest run db/sqliteSync.test.ts store/store.test.ts`
Expected: PASS em ambos. Se `store.test.ts` quebrar, ajustar o handler genérico para reproduzir o comportamento antigo (ex.: default de `timestamp`), nunca o teste.

- [ ] **Step 5: Commit**

```bash
git add frontend/db/sqlite.ts frontend/db/sqliteSync.test.ts
git commit -m "feat(web): add sync_metadata table (SQLite v4) and generic web driver handlers"
```

---

## Task 8: Frontend — `catalogSyncService.ts` (Delta Sync com ETag)

**Files:**
- Create: `frontend/lib/catalogSyncService.ts`
- Test: `frontend/lib/catalogSyncService.test.ts`

- [ ] **Step 1: Escrever os testes (falham)**

`frontend/lib/catalogSyncService.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const execute = vi.fn(async () => ({
    rows: { _array: [], length: 0, item: () => null },
    rowsAffected: 0,
  }));
  return {
    execute,
    getSyncMeta: vi.fn(async () => null as string | null),
    setSyncMeta: vi.fn(async () => {}),
  };
});

vi.mock('../db/sqlite', () => ({
  dbDriver: { execute: mocks.execute },
  getSyncMeta: mocks.getSyncMeta,
  setSyncMeta: mocks.setSyncMeta,
  getCausaByNomeCientifico: (n: string | null) => (n ? `Fungo (${n})` : 'Fatores abióticos'),
}));

vi.mock('./api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from './api';
import { syncCatalog } from './catalogSyncService';

describe('catalogSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSyncMeta.mockResolvedValue(null);
  });

  it('em 304 não aplica nada e não troca o ETag (T5.7 app-side)', async () => {
    mocks.getSyncMeta.mockResolvedValue('v1|abc');
    vi.mocked(api.get).mockResolvedValue({ status: 304, data: '' } as any);

    const result = await syncCatalog();

    expect(result.updated).toBe(false);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.setSyncMeta).not.toHaveBeenCalled();
    expect(vi.mocked(api.get).mock.calls[0][1]?.headers).toMatchObject({ 'If-None-Match': 'v1|abc' });
  });

  it('aplica upserts e deletes e persiste o novo ETag (T5.6 app-side)', async () => {
    vi.mocked(api.get).mockResolvedValue({
      status: 200,
      data: {
        catalog_version_hash: 'v2|def',
        has_more: false,
        next_cursor: null,
        updates: {
          culturas: [],
          doencas: [
            { action: 'upsert', data: { id: 'do-1', id_cultura: 'cultura-soja-id', nome_comum: 'Mancha Alvo', nome_cientifico: 'Corynespora cassiicola', sintomas: 'lesões circulares', nivel_severidade: 3 } },
          ],
          defensivos: [
            { action: 'delete', id: 'def-9' },
          ],
          doenca_defensivo: [
            { action: 'upsert', data: { id_doenca: 'do-1', id_defensivo: 'def-1', dosagem_recomendada: '300ml/ha', carencia_dias: 30, max_aplicacoes_ciclo: 2 } },
          ],
        },
      },
    } as any);

    const result = await syncCatalog();

    expect(result.updated).toBe(true);

    const sqls = mocks.execute.mock.calls.map((c: any[]) => c[0] as string);
    expect(sqls.some((s) => s.startsWith('INSERT OR REPLACE INTO doencas'))).toBe(true);
    expect(sqls.some((s) => s.startsWith('DELETE FROM doenca_defensivo WHERE id_defensivo'))).toBe(true);
    expect(sqls.some((s) => s.startsWith('DELETE FROM defensivos WHERE id'))).toBe(true);
    expect(sqls.some((s) => s.startsWith('INSERT OR REPLACE INTO doenca_defensivo'))).toBe(true);

    // causa calculada no upsert de doença
    const doencaCall = mocks.execute.mock.calls.find((c: any[]) => (c[0] as string).startsWith('INSERT OR REPLACE INTO doencas'));
    expect(doencaCall![1]).toContain('Fungo (Corynespora cassiicola)');

    expect(mocks.setSyncMeta).toHaveBeenCalledWith('catalog_etag', 'v2|def');
  });

  it('multi-página: só persiste o ETag após a última página', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({
        status: 200,
        data: {
          catalog_version_hash: 'v3|ghi',
          has_more: true,
          next_cursor: 'cursor-page-2',
          updates: { culturas: [], doencas: [{ action: 'upsert', data: { id: 'p1', id_cultura: 'c', nome_comum: 'A', nome_cientifico: null, sintomas: 's', nivel_severidade: 1 } }], defensivos: [], doenca_defensivo: [] },
        },
      } as any)
      .mockResolvedValueOnce({
        status: 200,
        data: {
          catalog_version_hash: 'v3|ghi',
          has_more: false,
          next_cursor: null,
          updates: { culturas: [], doencas: [{ action: 'upsert', data: { id: 'p2', id_cultura: 'c', nome_comum: 'B', nome_cientifico: null, sintomas: 's', nivel_severidade: 1 } }], defensivos: [], doenca_defensivo: [] },
        },
      } as any);

    await syncCatalog();

    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.get).mock.calls[1][1]?.params).toMatchObject({ cursor: 'cursor-page-2' });
    expect(mocks.setSyncMeta).toHaveBeenCalledTimes(1);
    expect(mocks.setSyncMeta).toHaveBeenCalledWith('catalog_etag', 'v3|ghi');
  });
});
```

- [ ] **Step 2: Rodar para confirmar falha**

Run: `cd frontend && npx vitest run lib/catalogSyncService.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

`frontend/lib/catalogSyncService.ts`:

```ts
// frontend/lib/catalogSyncService.ts
// Delta Sync do catálogo local (RNF: economizar dados móveis via ETag/304)
import { api } from './api';
import { dbDriver, getSyncMeta, setSyncMeta, getCausaByNomeCientifico } from '../db/sqlite';

export const CATALOG_ETAG_KEY = 'catalog_etag';
const PAGE_LIMIT = 100;

type UpdateEntry =
  | { action: 'upsert'; data: any }
  | { action: 'delete'; id: string };

interface CatalogSyncPage {
  catalog_version_hash: string;
  next_cursor: string | null;
  has_more: boolean;
  updates: {
    culturas?: UpdateEntry[];
    doencas?: UpdateEntry[];
    defensivos?: UpdateEntry[];
    doenca_defensivo?: UpdateEntry[];
  };
}

async function applyUpdates(updates: CatalogSyncPage['updates']): Promise<void> {
  // Ordem importa: culturas → doencas → defensivos → doenca_defensivo (FKs locais)
  for (const c of updates.culturas ?? []) {
    if (c.action === 'delete') {
      await dbDriver.execute('DELETE FROM culturas WHERE id = ?;', [c.id]);
    } else {
      await dbDriver.execute(
        'INSERT OR REPLACE INTO culturas (id, nome, estagio_fenologico_padrao) VALUES (?, ?, ?);',
        [c.data.id, c.data.nome, JSON.stringify(c.data.estagio_fenologico_padrao ?? [])]
      );
    }
  }

  for (const d of updates.doencas ?? []) {
    if (d.action === 'delete') {
      await dbDriver.execute('DELETE FROM doenca_defensivo WHERE id_doenca = ?;', [d.id]);
      await dbDriver.execute('DELETE FROM doencas WHERE id = ?;', [d.id]);
    } else {
      await dbDriver.execute(
        'INSERT OR REPLACE INTO doencas (id, id_cultura, nome_comum, nome_cientifico, sintomas, nivel_severidade, causa) VALUES (?, ?, ?, ?, ?, ?, ?);',
        [
          d.data.id,
          d.data.id_cultura,
          d.data.nome_comum,
          d.data.nome_cientifico,
          d.data.sintomas,
          d.data.nivel_severidade,
          getCausaByNomeCientifico(d.data.nome_cientifico),
        ]
      );
    }
  }

  for (const f of updates.defensivos ?? []) {
    if (f.action === 'delete') {
      await dbDriver.execute('DELETE FROM doenca_defensivo WHERE id_defensivo = ?;', [f.id]);
      await dbDriver.execute('DELETE FROM defensivos WHERE id = ?;', [f.id]);
    } else {
      await dbDriver.execute(
        'INSERT OR REPLACE INTO defensivos (id, nome_comercial, ingrediente_ativo, classe, fabricante, grupo_quimico_frac, bula_resumida) VALUES (?, ?, ?, ?, ?, ?, ?);',
        [
          f.data.id,
          f.data.nome_comercial,
          f.data.ingrediente_ativo,
          f.data.classe,
          f.data.fabricante,
          f.data.grupo_quimico_frac,
          JSON.stringify(f.data.bula_resumida ?? {}),
        ]
      );
    }
  }

  for (const rel of updates.doenca_defensivo ?? []) {
    if (rel.action === 'upsert') {
      await dbDriver.execute(
        'INSERT OR REPLACE INTO doenca_defensivo (id_doenca, id_defensivo, dosagem_recomendada, carencia_dias, max_aplicacoes_ciclo) VALUES (?, ?, ?, ?, ?);',
        [
          rel.data.id_doenca,
          rel.data.id_defensivo,
          rel.data.dosagem_recomendada,
          rel.data.carencia_dias,
          rel.data.max_aplicacoes_ciclo ?? 0,
        ]
      );
    }
  }
}

export async function syncCatalog(): Promise<{ updated: boolean }> {
  const etag = await getSyncMeta(CATALOG_ETAG_KEY);
  let cursor: string | null = null;
  let newEtag: string | null = null;
  let applied = false;

  do {
    const res = await api.get('/api/v1/catalog/sync', {
      headers: etag ? { 'If-None-Match': etag } : {},
      params: { limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) },
      validateStatus: (s: number) => s === 200 || s === 304,
    });

    if (res.status === 304) {
      console.log('[CatalogSync] Catálogo local já está atualizado (304).');
      return { updated: false };
    }

    const page = res.data as CatalogSyncPage;
    await applyUpdates(page.updates ?? {});
    applied = true;
    newEtag = page.catalog_version_hash;
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);

  // ETag só é persistido após consumir TODAS as páginas — interrupção no meio
  // faz o próximo sync recomeçar do ETag antigo (upserts são idempotentes).
  if (newEtag) {
    await setSyncMeta(CATALOG_ETAG_KEY, newEtag);
  }

  console.log('[CatalogSync] Catálogo local atualizado.');
  return { updated: applied };
}
```

- [ ] **Step 4: Rodar testes**

Run: `cd frontend && npx vitest run lib/catalogSyncService.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/catalogSyncService.ts frontend/lib/catalogSyncService.test.ts
git commit -m "feat(web): add catalog delta sync client with ETag and cursor pagination"
```

---

## Task 9: Frontend — `syncService.ts` (orquestrador Store & Forward)

**Files:**
- Create: `frontend/lib/syncService.ts`
- Test: `frontend/lib/syncService.test.ts`

> **ANTES DE CODAR:** `frontend/AGENTS.md` exige consultar os docs do Expo v56. Verifique em https://docs.expo.dev/versions/v56.0.0/sdk/filesystem/ qual é o import correto de `uploadAsync` no SDK 56 (a partir do SDK 54 a API legada vive em `expo-file-system/legacy`; a API nova usa classes `File`/`Directory`). O código abaixo assume `require('expo-file-system/legacy')` — ajuste se os docs disserem outra coisa.

- [ ] **Step 1: Escrever os testes (falham)**

`frontend/lib/syncService.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const tables: Record<string, any[]> = {
    fila_diagnosticos: [],
    fila_feedbacks: [],
    fila_slm_logs: [],
  };

  const wrap = (arr: any[]) => ({
    rows: { _array: arr, length: arr.length, item: (i: number) => arr[i] },
    rowsAffected: 0,
  });
  const empty = wrap([]);

  const execute = vi.fn(async (sql: string, params: any[] = []) => {
    const s = sql.trim().replace(/\s+/g, ' ').toLowerCase();

    const selStatus = s.match(/^select \* from (\w+) where sync_status = \?/);
    if (selStatus) return wrap(tables[selStatus[1]].filter((r) => r.sync_status === params[0]));

    const selAll = s.match(/^select \* from (\w+);?$/);
    if (selAll) return wrap([...tables[selAll[1]]]);

    const upd = s.match(/^update (\w+) set (.+?) where (\w+) = \?;?$/);
    if (upd) {
      const cols = upd[2].split(',').map((x) => x.trim().split('=')[0].trim());
      const row = tables[upd[1]].find((r) => r[upd[3]] === params[params.length - 1]);
      if (row) cols.forEach((c, i) => { row[c] = params[i]; });
      return empty;
    }

    if (s.startsWith('delete')) return empty;
    return empty;
  });

  return {
    tables,
    execute,
    network: { connectionMode: 'ONLINE' },
    auth: { isAuthenticated: true },
  };
});

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('../db/sqlite', () => ({
  dbDriver: { execute: mocks.execute },
  getSyncMeta: vi.fn(async () => null),
  setSyncMeta: vi.fn(async () => {}),
}));
vi.mock('./api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('./catalogSyncService', () => ({ syncCatalog: vi.fn(async () => ({ updated: false })) }));
vi.mock('../store/useNetworkStore', () => ({ useNetworkStore: { getState: () => mocks.network } }));
vi.mock('../store/useAuthStore', () => ({ useAuthStore: { getState: () => mocks.auth } }));

import { api } from './api';
import {
  runFullSync, syncPendingDiagnostics, syncPendingSlmLogs, MAX_RETRIES,
} from './syncService';

function seedDiagnostic(overrides: Record<string, any> = {}) {
  const row = {
    local_id: 'l1',
    server_id: null,
    image_uri: 'https://example.com/leaf.jpg',
    image_s3_key: null,
    latitude: -23.5,
    longitude: -46.6,
    doenca_id: 'doenca-1',
    confianca_ia: 0.9,
    modelo_usado: 'tflite_v1.0',
    tempo_inferencia_ms: 40,
    timestamp: '2026-06-10 12:00:00',
    sync_status: 'PENDING',
    retry_count: 0,
    ...overrides,
  };
  mocks.tables.fila_diagnosticos.push(row);
  return row;
}

describe('syncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tables.fila_diagnosticos.length = 0;
    mocks.tables.fila_feedbacks.length = 0;
    mocks.tables.fila_slm_logs.length = 0;
    mocks.network.connectionMode = 'ONLINE';
    mocks.auth.isAuthenticated = true;

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('example.com')) {
        return { ok: true, status: 200, blob: async () => new Uint8Array([1, 2, 3]) } as any;
      }
      return { ok: true, status: 200 } as any; // PUT no S3
    }));
  });

  it('fluxo feliz: upload + batch + SYNCED com server_id (T5.2 app-side)', async () => {
    const row = seedDiagnostic();
    vi.mocked(api.post).mockImplementation(async (url: string) => {
      if (url.includes('/upload/url')) {
        return { data: { upload_url: 'https://s3.local/put', s3_key: 'diagnosticos/u/x.jpg', expires_in: 600 } } as any;
      }
      return {
        data: {
          status: 'success', synced_count: 1, failed_count: 0,
          synced_items: [{ local_id: 'l1', server_id: 'srv-1' }],
          failed_items: [],
        },
      } as any;
    });

    const result = await syncPendingDiagnostics();

    expect(result.synced).toBe(1);
    expect(row.image_s3_key).toBe('diagnosticos/u/x.jpg');
    expect(row.sync_status).toBe('SYNCED');
    expect(row.server_id).toBe('srv-1');
  });

  it('falha no upload mantém PENDING e não envia o lote (T5.8)', async () => {
    const row = seedDiagnostic();
    vi.mocked(api.post).mockResolvedValue({
      data: { upload_url: 'https://s3.local/put', s3_key: 'diagnosticos/u/x.jpg', expires_in: 600 },
    } as any);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('example.com')) {
        return { ok: true, status: 200, blob: async () => new Uint8Array([1]) } as any;
      }
      return { ok: false, status: 500 } as any; // PUT no S3 falha
    }));

    const result = await syncPendingDiagnostics();

    expect(result.synced).toBe(0);
    expect(row.sync_status).toBe('PENDING');
    const syncCalls = vi.mocked(api.post).mock.calls.filter((c) => String(c[0]).includes('/sync/diagnostics'));
    expect(syncCalls).toHaveLength(0);
  });

  it('failed_item incrementa retry e vira FAILED no limite', async () => {
    const row = seedDiagnostic({ image_s3_key: 'diagnosticos/u/x.jpg', retry_count: MAX_RETRIES - 1 });
    vi.mocked(api.post).mockResolvedValue({
      data: {
        status: 'partial', synced_count: 0, failed_count: 1,
        synced_items: [],
        failed_items: [{ local_id: 'l1', error_code: 'INVALID_DOENCA_ID', message: 'x' }],
      },
    } as any);

    await syncPendingDiagnostics();

    expect(row.sync_status).toBe('FAILED');
    expect(row.retry_count).toBe(MAX_RETRIES);
  });

  it('itens FAILED só entram com includeFailed (sync manual)', async () => {
    seedDiagnostic({ local_id: 'lf', sync_status: 'FAILED', retry_count: MAX_RETRIES, image_s3_key: 'diagnosticos/u/f.jpg' });
    vi.mocked(api.post).mockResolvedValue({
      data: { status: 'success', synced_count: 1, failed_count: 0, synced_items: [{ local_id: 'lf', server_id: 'srv-f' }], failed_items: [] },
    } as any);

    const auto = await syncPendingDiagnostics(false);
    expect(auto.synced).toBe(0);

    const manual = await syncPendingDiagnostics(true);
    expect(manual.synced).toBe(1);
  });

  it('sincroniza logs SLM parseando interactions_json (T5.5 app-side)', async () => {
    mocks.tables.fila_slm_logs.push({
      session_id: 'sess-1',
      started_at: '2026-06-09T14:00:00Z',
      model_version: 'gemma-2b-it-q4_k_m',
      interactions_json: JSON.stringify([{ prompt: 'Oi', response: 'Olá', latency_ms: 900, rag_used_documents: [] }]),
      sync_status: 'PENDING',
      retry_count: 0,
    });
    vi.mocked(api.post).mockResolvedValue({ data: { status: 'success', processed_count: 1 } } as any);

    const result = await syncPendingSlmLogs();

    expect(result.synced).toBe(1);
    const call = vi.mocked(api.post).mock.calls.find((c) => String(c[0]).includes('/sync/slm-logs'));
    expect((call![1] as any).slm_sessions[0].interactions[0].prompt).toBe('Oi');
    expect(mocks.tables.fila_slm_logs[0].sync_status).toBe('SYNCED');
  });

  it('runFullSync não roda em modo FIELD', async () => {
    mocks.network.connectionMode = 'FIELD';
    seedDiagnostic();

    const result = await runFullSync();

    expect(result.ran).toBe(false);
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar para confirmar falha**

Run: `cd frontend && npx vitest run lib/syncService.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

`frontend/lib/syncService.ts`:

```ts
// frontend/lib/syncService.ts
// Orquestrador Store & Forward: fila local → backend quando há conectividade
import { Platform } from 'react-native';
import { api } from './api';
import { dbDriver } from '../db/sqlite';
import { syncCatalog } from './catalogSyncService';

export const MAX_RETRIES = 5;
export const CLEANUP_DAYS = 30;

type QueueRow = Record<string, any>;

export interface StepResult { synced: number; failed: number }

export interface FullSyncResult {
  ran: boolean;
  diagnostics: StepResult;
  feedbacks: StepResult;
  slmLogs: StepResult;
  catalogUpdated: boolean;
}

const EMPTY_RESULT: FullSyncResult = {
  ran: false,
  diagnostics: { synced: 0, failed: 0 },
  feedbacks: { synced: 0, failed: 0 },
  slmLogs: { synced: 0, failed: 0 },
  catalogUpdated: false,
};

function toArray(res: any): QueueRow[] {
  const out: QueueRow[] = [];
  for (let i = 0; i < res.rows.length; i++) out.push(res.rows.item(i));
  return out;
}

async function getQueueRows(table: string, includeFailed: boolean): Promise<QueueRow[]> {
  const pending = toArray(
    await dbDriver.execute(`SELECT * FROM ${table} WHERE sync_status = ?;`, ['PENDING'])
  ).filter((r) => (r.retry_count ?? 0) < MAX_RETRIES);

  if (!includeFailed) return pending;

  // Sync manual: itens FAILED voltam para o ciclo com retry zerado
  const failed = toArray(
    await dbDriver.execute(`SELECT * FROM ${table} WHERE sync_status = ?;`, ['FAILED'])
  ).map((r) => ({ ...r, retry_count: 0 }));

  return [...pending, ...failed];
}

function toIso(value: string | undefined): string {
  const parsed = value ? new Date(value.replace(' ', 'T')) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

// Upload em 2 passos: presigned URL → PUT direto no S3. Grava o s3_key no SQLite
// ANTES de retornar, para retomar do ponto certo se a conexão cair depois.
async function uploadImageForDiagnostic(row: QueueRow): Promise<string> {
  const imageUri: string = row.image_uri;
  const contentType = imageUri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  const filename = imageUri.split('/').pop() || 'diagnostico.jpg';

  const { data } = await api.post('/api/v1/upload/url', { filename, content_type: contentType });

  if (Platform.OS !== 'web' && imageUri.startsWith('file://')) {
    // Nativo: stream do arquivo local direto ao S3 (sem carregar em memória)
    const FileSystem = require('expo-file-system/legacy');
    const result = await FileSystem.uploadAsync(data.upload_url, imageUri, {
      httpMethod: 'PUT',
      headers: { 'Content-Type': contentType },
    });
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`S3 upload failed: HTTP ${result.status}`);
    }
  } else {
    // Web/dev (URIs http(s) dos mocks): baixa os bytes e envia via fetch
    const source = await fetch(imageUri);
    const blob = await source.blob();
    const putRes = await fetch(data.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: blob,
    });
    if (!putRes.ok) throw new Error(`S3 upload failed: HTTP ${putRes.status}`);
  }

  await dbDriver.execute(
    'UPDATE fila_diagnosticos SET image_s3_key = ? WHERE local_id = ?;',
    [data.s3_key, row.local_id]
  );
  return data.s3_key;
}

async function markRetry(table: string, keyCol: string, row: QueueRow): Promise<void> {
  const retries = (row.retry_count ?? 0) + 1;
  const status = retries >= MAX_RETRIES ? 'FAILED' : 'PENDING';
  await dbDriver.execute(
    `UPDATE ${table} SET sync_status = ?, retry_count = ? WHERE ${keyCol} = ?;`,
    [status, retries, row[keyCol]]
  );
}

export async function syncPendingDiagnostics(includeFailed = false): Promise<StepResult> {
  const rows = await getQueueRows('fila_diagnosticos', includeFailed);
  if (rows.length === 0) return { synced: 0, failed: 0 };

  const ready: QueueRow[] = [];
  for (const row of rows) {
    if (!row.image_s3_key) {
      try {
        row.image_s3_key = await uploadImageForDiagnostic(row);
      } catch (err) {
        // T5.8: item fica fora do lote desta rodada, permanece PENDING
        console.warn(`[Sync] Upload falhou para ${row.local_id}; mantido como PENDING.`, err);
        continue;
      }
    }
    ready.push(row);
  }
  if (ready.length === 0) return { synced: 0, failed: 0 };

  const { data } = await api.post('/api/v1/sync/diagnostics', {
    diagnostics: ready.map((r) => ({
      local_id: r.local_id,
      timestamp: toIso(r.timestamp),
      image_s3_key: r.image_s3_key,
      location: { lat: r.latitude ?? 0, lng: r.longitude ?? 0 },
      ai_result: {
        doenca_id: r.doenca_id,
        confianca: r.confianca_ia ?? 0,
        modelo_usado: r.modelo_usado,
        tempo_inferencia_ms: r.tempo_inferencia_ms ?? 0,
      },
    })),
  });

  for (const item of data.synced_items ?? []) {
    await dbDriver.execute(
      'UPDATE fila_diagnosticos SET sync_status = ?, server_id = ? WHERE local_id = ?;',
      ['SYNCED', item.server_id, item.local_id]
    );
  }
  for (const item of data.failed_items ?? []) {
    const row = ready.find((r) => r.local_id === item.local_id);
    if (row) await markRetry('fila_diagnosticos', 'local_id', row);
  }

  return { synced: data.synced_count ?? 0, failed: data.failed_count ?? 0 };
}

export async function syncPendingFeedbacks(includeFailed = false): Promise<StepResult> {
  const rows = await getQueueRows('fila_feedbacks', includeFailed);
  if (rows.length === 0) return { synced: 0, failed: 0 };

  // server_id do diagnóstico correspondente, quando já sincronizado
  const diagRows = toArray(await dbDriver.execute('SELECT * FROM fila_diagnosticos;'));
  const serverIdByLocal: Record<string, string | null> = {};
  for (const d of diagRows) serverIdByLocal[d.local_id] = d.server_id ?? null;

  const { data } = await api.post('/api/v1/sync/feedback', {
    feedbacks: rows.map((r) => ({
      diagnostic_server_id: serverIdByLocal[r.diagnostic_local_id] ?? null,
      diagnostic_local_id: r.diagnostic_local_id,
      timestamp_feedback: toIso(r.timestamp),
      is_correct: !!r.is_correct,
      user_correction_notes: r.user_correction_notes ?? null,
      corrected_doenca_id: r.corrected_doenca_id ?? null,
    })),
  });

  for (const item of data.processed_items ?? []) {
    await dbDriver.execute(
      'UPDATE fila_feedbacks SET sync_status = ? WHERE diagnostic_local_id = ?;',
      ['SYNCED', item.diagnostic_local_id]
    );
  }
  for (const item of data.failed_items ?? []) {
    const row = rows.find((r) => r.diagnostic_local_id === item.diagnostic_local_id);
    if (row) await markRetry('fila_feedbacks', 'diagnostic_local_id', row);
  }

  return { synced: data.processed_count ?? 0, failed: data.failed_count ?? 0 };
}

export async function syncPendingSlmLogs(includeFailed = false): Promise<StepResult> {
  const rows = await getQueueRows('fila_slm_logs', includeFailed);
  if (rows.length === 0) return { synced: 0, failed: 0 };

  const { data } = await api.post('/api/v1/sync/slm-logs', {
    slm_sessions: rows.map((r) => ({
      session_id: r.session_id,
      started_at: toIso(r.started_at),
      model_version: r.model_version,
      interactions: JSON.parse(r.interactions_json || '[]'),
    })),
  });

  if (data.status === 'success') {
    for (const r of rows) {
      await dbDriver.execute(
        'UPDATE fila_slm_logs SET sync_status = ? WHERE session_id = ?;',
        ['SYNCED', r.session_id]
      );
    }
  }

  return { synced: data.processed_count ?? 0, failed: 0 };
}

export async function cleanupSyncedRecords(): Promise<void> {
  const cutoff = new Date(Date.now() - CLEANUP_DAYS * 24 * 60 * 60 * 1000).toISOString();
  // fila_feedbacks primeiro (FK para fila_diagnosticos)
  await dbDriver.execute(
    "DELETE FROM fila_feedbacks WHERE sync_status = 'SYNCED' AND datetime(timestamp) < datetime(?);",
    [cutoff]
  );
  await dbDriver.execute(
    "DELETE FROM fila_diagnosticos WHERE sync_status = 'SYNCED' AND datetime(timestamp) < datetime(?);",
    [cutoff]
  );
  await dbDriver.execute(
    "DELETE FROM fila_slm_logs WHERE sync_status = 'SYNCED' AND datetime(started_at) < datetime(?);",
    [cutoff]
  );
}

let syncInProgress = false;

export async function runFullSync(opts: { includeFailed?: boolean } = {}): Promise<FullSyncResult> {
  if (syncInProgress) return EMPTY_RESULT;

  // require() tardio para evitar ciclo de imports (mesmo padrão de lib/api.ts)
  const { useNetworkStore } = require('../store/useNetworkStore');
  const { useAuthStore } = require('../store/useAuthStore');

  const mode = useNetworkStore.getState().connectionMode;
  if (mode !== 'ONLINE' && mode !== 'DEGRADED') return EMPTY_RESULT;
  if (!useAuthStore.getState().isAuthenticated) return EMPTY_RESULT;

  syncInProgress = true;
  console.log('[Sync] Iniciando sincronização completa...');
  try {
    const includeFailed = opts.includeFailed ?? false;
    const diagnostics = await syncPendingDiagnostics(includeFailed);
    const feedbacks = await syncPendingFeedbacks(includeFailed);
    const slmLogs = await syncPendingSlmLogs(includeFailed);
    const catalog = await syncCatalog();
    await cleanupSyncedRecords();
    console.log('[Sync] Sincronização concluída.', { diagnostics, feedbacks, slmLogs });
    return { ran: true, diagnostics, feedbacks, slmLogs, catalogUpdated: catalog.updated };
  } finally {
    syncInProgress = false;
  }
}
```

- [ ] **Step 4: Rodar testes**

Run: `cd frontend && npx vitest run lib/syncService.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/syncService.ts frontend/lib/syncService.test.ts
git commit -m "feat(web): add store-and-forward sync orchestrator with 2-step image upload"
```

---

## Task 10: Frontend — `useSyncStore` (Zustand)

**Files:**
- Create: `frontend/store/useSyncStore.ts`
- Test: `frontend/store/useSyncStore.test.ts`

- [ ] **Step 1: Escrever os testes (falham)**

`frontend/store/useSyncStore.test.ts`:

```ts
import './test-globals';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const tables: Record<string, any[]> = {
    fila_diagnosticos: [],
    fila_feedbacks: [],
    fila_slm_logs: [],
  };
  const wrap = (arr: any[]) => ({
    rows: { _array: arr, length: arr.length, item: (i: number) => arr[i] },
    rowsAffected: 0,
  });
  const execute = vi.fn(async (sql: string) => {
    const m = sql.trim().toLowerCase().match(/^select \* from (\w+)/);
    if (m) return wrap([...tables[m[1]]]);
    return wrap([]);
  });
  return { tables, execute };
});

vi.mock('../db/sqlite', () => ({ dbDriver: { execute: mocks.execute } }));
vi.mock('../lib/syncService', () => ({
  runFullSync: vi.fn(async () => ({
    ran: true,
    diagnostics: { synced: 1, failed: 0 },
    feedbacks: { synced: 0, failed: 0 },
    slmLogs: { synced: 0, failed: 0 },
    catalogUpdated: false,
  })),
}));

import { runFullSync } from '../lib/syncService';
import { useSyncStore } from './useSyncStore';

describe('useSyncStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tables.fila_diagnosticos.length = 0;
    mocks.tables.fila_feedbacks.length = 0;
    mocks.tables.fila_slm_logs.length = 0;
    useSyncStore.setState({
      pendingDiagnostics: 0, pendingFeedbacks: 0, pendingSlmLogs: 0,
      isSyncing: false, lastSyncAt: null, lastError: null,
    });
  });

  it('refreshCounts conta PENDING e FAILED (T5.9 logic-level)', async () => {
    mocks.tables.fila_diagnosticos.push(
      { local_id: 'a', sync_status: 'PENDING' },
      { local_id: 'b', sync_status: 'FAILED' },
      { local_id: 'c', sync_status: 'SYNCED' },
    );
    mocks.tables.fila_slm_logs.push({ session_id: 's', sync_status: 'PENDING' });

    await useSyncStore.getState().refreshCounts();

    expect(useSyncStore.getState().pendingDiagnostics).toBe(2);
    expect(useSyncStore.getState().pendingFeedbacks).toBe(0);
    expect(useSyncStore.getState().pendingSlmLogs).toBe(1);
  });

  it('syncNow roda o sync, atualiza lastSyncAt e contagens', async () => {
    await useSyncStore.getState().syncNow({ manual: true });

    expect(vi.mocked(runFullSync)).toHaveBeenCalledWith({ includeFailed: true });
    expect(useSyncStore.getState().isSyncing).toBe(false);
    expect(useSyncStore.getState().lastSyncAt).toBeTruthy();
    expect(useSyncStore.getState().lastError).toBeNull();
  });

  it('syncNow concorrente é no-op (guard isSyncing)', async () => {
    let resolveSync!: () => void;
    vi.mocked(runFullSync).mockImplementation(
      () => new Promise((resolve) => {
        resolveSync = () => resolve({
          ran: true,
          diagnostics: { synced: 0, failed: 0 },
          feedbacks: { synced: 0, failed: 0 },
          slmLogs: { synced: 0, failed: 0 },
          catalogUpdated: false,
        });
      })
    );

    const first = useSyncStore.getState().syncNow();
    expect(useSyncStore.getState().isSyncing).toBe(true);

    const second = useSyncStore.getState().syncNow();
    resolveSync();
    await Promise.all([first, second]);

    expect(vi.mocked(runFullSync)).toHaveBeenCalledTimes(1);
  });

  it('erro no sync popula lastError', async () => {
    vi.mocked(runFullSync).mockRejectedValue(new Error('Network down'));

    await useSyncStore.getState().syncNow();

    expect(useSyncStore.getState().lastError).toBe('Network down');
    expect(useSyncStore.getState().isSyncing).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar para confirmar falha**

Run: `cd frontend && npx vitest run store/useSyncStore.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

`frontend/store/useSyncStore.ts`:

```ts
// frontend/store/useSyncStore.ts
// Estado da sincronização Store & Forward (badge, progresso, gatilho manual)
import { create } from 'zustand';
import { dbDriver } from '../db/sqlite';
import { runFullSync } from '../lib/syncService';

interface SyncState {
  pendingDiagnostics: number;
  pendingFeedbacks: number;
  pendingSlmLogs: number;
  isSyncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  refreshCounts: () => Promise<void>;
  syncNow: (opts?: { manual?: boolean }) => Promise<void>;
}

function countUnsynced(res: any): number {
  let total = 0;
  for (let i = 0; i < res.rows.length; i++) {
    const status = res.rows.item(i).sync_status;
    if (status === 'PENDING' || status === 'FAILED') total += 1;
  }
  return total;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  pendingDiagnostics: 0,
  pendingFeedbacks: 0,
  pendingSlmLogs: 0,
  isSyncing: false,
  lastSyncAt: null,
  lastError: null,

  refreshCounts: async () => {
    try {
      const [diags, feedbacks, slmLogs] = await Promise.all([
        dbDriver.execute('SELECT * FROM fila_diagnosticos;'),
        dbDriver.execute('SELECT * FROM fila_feedbacks;'),
        dbDriver.execute('SELECT * FROM fila_slm_logs;'),
      ]);
      set({
        pendingDiagnostics: countUnsynced(diags),
        pendingFeedbacks: countUnsynced(feedbacks),
        pendingSlmLogs: countUnsynced(slmLogs),
      });
    } catch (err) {
      console.warn('[SyncStore] Falha ao contar pendências:', err);
    }
  },

  syncNow: async (opts = {}) => {
    if (get().isSyncing) return;
    set({ isSyncing: true, lastError: null });
    try {
      const result = await runFullSync({ includeFailed: !!opts.manual });
      if (result.ran) {
        set({ lastSyncAt: new Date().toISOString() });
      }
    } catch (err: any) {
      set({ lastError: err?.message ?? 'Falha na sincronização' });
    } finally {
      set({ isSyncing: false });
      await get().refreshCounts();
    }
  },
}));
```

- [ ] **Step 4: Rodar testes**

Run: `cd frontend && npx vitest run store/useSyncStore.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add frontend/store/useSyncStore.ts frontend/store/useSyncStore.test.ts
git commit -m "feat(web): add sync store with pending counts and concurrency guard"
```

---

## Task 11: Frontend — captura de logs SLM no chat offline

**Files:**
- Modify: `frontend/store/useChatStore.ts`
- Modify: `frontend/app/chat.tsx` (linhas ~126-140, branch `isField`)
- Test: `frontend/store/chatSlmLog.test.ts`

- [ ] **Step 1: Escrever o teste (falha)**

`frontend/store/chatSlmLog.test.ts`:

```ts
import './test-globals';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const tables: Record<string, any[]> = { fila_slm_logs: [] };
  const wrap = (arr: any[]) => ({
    rows: { _array: arr, length: arr.length, item: (i: number) => arr[i] },
    rowsAffected: 0,
  });
  const execute = vi.fn(async (sql: string, params: any[] = []) => {
    const s = sql.trim().replace(/\s+/g, ' ').toLowerCase();
    if (s.startsWith('select * from fila_slm_logs where session_id = ?')) {
      return wrap(tables.fila_slm_logs.filter((r) => r.session_id === params[0]));
    }
    if (s.startsWith('insert into fila_slm_logs')) {
      tables.fila_slm_logs.push({
        session_id: params[0], started_at: params[1], model_version: params[2],
        interactions_json: params[3], sync_status: params[4], retry_count: params[5],
      });
      return wrap([]);
    }
    if (s.startsWith('update fila_slm_logs set interactions_json = ?, sync_status = ? where session_id = ?')) {
      const row = tables.fila_slm_logs.find((r) => r.session_id === params[2]);
      if (row) { row.interactions_json = params[0]; row.sync_status = params[1]; }
      return wrap([]);
    }
    return wrap([]);
  });
  return { tables, execute };
});

vi.mock('../db/sqlite', () => ({ dbDriver: { execute: mocks.execute } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'fixed-session-uuid' }));

import { useChatStore } from './useChatStore';

describe('useChatStore.logSlmInteraction', () => {
  beforeEach(() => {
    mocks.tables.fila_slm_logs.length = 0;
    vi.clearAllMocks();
  });

  it('primeira interação cria a linha; segunda acumula no interactions_json', async () => {
    const store = useChatStore.getState();

    await store.logSlmInteraction('Como aplico fungicida?', 'Recomenda-se...', 3200);
    expect(mocks.tables.fila_slm_logs).toHaveLength(1);

    await store.logSlmInteraction('E na chuva?', 'Evite aplicar...', 2800);
    expect(mocks.tables.fila_slm_logs).toHaveLength(1);

    const row = mocks.tables.fila_slm_logs[0];
    expect(row.sync_status).toBe('PENDING');
    expect(row.model_version).toBe('gemma-2b-it-q4_k_m');

    const interactions = JSON.parse(row.interactions_json);
    expect(interactions).toHaveLength(2);
    expect(interactions[0]).toMatchObject({ prompt: 'Como aplico fungicida?', latency_ms: 3200, rag_used_documents: [] });
    expect(interactions[1].prompt).toBe('E na chuva?');
  });
});
```

- [ ] **Step 2: Rodar para confirmar falha**

Run: `cd frontend && npx vitest run store/chatSlmLog.test.ts`
Expected: FAIL — `logSlmInteraction` não existe.

- [ ] **Step 3: Implementar no `useChatStore.ts`**

Adicionar à interface `ChatState`:

```ts
  logSlmInteraction: (prompt: string, response: string, latencyMs: number) => Promise<void>;
```

Adicionar constante no topo do arquivo (após os imports):

```ts
// Mantém paridade com SLM_MODEL_FILENAME de lib/slmChatService.ts (sem import
// para não puxar expo-file-system para dentro do store)
const SLM_MODEL_VERSION = 'gemma-2b-it-q4_k_m';
```

Adicionar a ação ao store (após `expandForCloud`):

```ts
  logSlmInteraction: async (prompt, response, latencyMs) => {
    try {
      const { dbDriver } = require('../db/sqlite');
      const sessionId = get().sessionId;
      const interaction = {
        prompt,
        response,
        latency_ms: Math.round(latencyMs),
        rag_used_documents: [] as unknown[],
      };

      const res = await dbDriver.execute(
        'SELECT * FROM fila_slm_logs WHERE session_id = ?;',
        [sessionId]
      );

      if (res.rows.length > 0) {
        // Upsert por sessão: acumula a interação (nada se perde se o app fechar)
        const interactions = JSON.parse(res.rows.item(0).interactions_json || '[]');
        interactions.push(interaction);
        await dbDriver.execute(
          'UPDATE fila_slm_logs SET interactions_json = ?, sync_status = ? WHERE session_id = ?;',
          [JSON.stringify(interactions), 'PENDING', sessionId]
        );
      } else {
        await dbDriver.execute(
          'INSERT INTO fila_slm_logs (session_id, started_at, model_version, interactions_json, sync_status, retry_count) VALUES (?, ?, ?, ?, ?, ?);',
          [sessionId, new Date().toISOString(), SLM_MODEL_VERSION, JSON.stringify([interaction]), 'PENDING', 0]
        );
      }
    } catch (err) {
      console.warn('[ChatStore] Falha ao registrar log SLM local:', err);
    }
  },
```

- [ ] **Step 4: Rodar o teste**

Run: `cd frontend && npx vitest run store/chatSlmLog.test.ts`
Expected: PASS.

- [ ] **Step 5: Conectar no `chat.tsx`**

No branch `isField` de `sendMessage` (atualmente linhas ~126-140), substituir o bloco `try/catch` por:

```ts
      const slmStart = Date.now();
      let slmResponse = '';
      try {
        await slmChat({
          messages: [...slmHistory, { role: 'user', content: text }],
          sqliteContext: sqliteCtx,
          onToken: (token) => {
            slmResponse += token;
            appendToStreaming(token);
          },
          signal: abortControllerRef.current.signal,
        });
        finalizeStreaming('LOCAL_SLM');
      } catch {
        finalizeStreaming('LOCAL_SLM');
      } finally {
        // Telemetria offline (fila_slm_logs) — sincronizada pela Sprint 5
        if (slmResponse.trim()) {
          useChatStore.getState().logSlmInteraction(text, slmResponse, Date.now() - slmStart);
        }
      }
```

- [ ] **Step 6: Rodar a suíte frontend completa**

Run: `cd frontend && npx vitest run`
Expected: PASS em todos os arquivos.

- [ ] **Step 7: Commit**

```bash
git add frontend/store/useChatStore.ts frontend/store/chatSlmLog.test.ts frontend/app/chat.tsx
git commit -m "feat(web): capture offline SLM interactions into fila_slm_logs"
```

---

## Task 12: Frontend — UI de sync na home + gatilho automático FIELD→ONLINE

**Files:**
- Modify: `frontend/app/index.tsx`
- Modify: `frontend/app/_layout.tsx`

Sem testes unitários novos (UI + wiring); validação manual na Task 13 (T5.9).

- [ ] **Step 1: Gatilho automático no `_layout.tsx`**

Adicionar import:

```ts
import { useSyncStore } from '../store/useSyncStore';
```

Adicionar um segundo `useEffect` após o de boot (o boot já chama `initNetworkSensing`):

```ts
  // 1b. Auto-sync Store & Forward na transição para ONLINE (volta para a sede)
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = useNetworkStore.subscribe((state, prev) => {
      if (state.connectionMode === 'ONLINE' && prev.connectionMode !== 'ONLINE') {
        // Debounce de 2s contra oscilações de sinal
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          console.log('[RootLayout] Conexão restabelecida — disparando sync automático...');
          useSyncStore.getState().syncNow();
        }, 2000);
      }
      if (state.connectionMode === 'FIELD' && debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    });

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribe();
    };
  }, []);
```

> NOTA: a primeira transição PROBING→ONLINE no boot também dispara — isso cobre o requisito "delta sync do catálogo ao abrir o app" (o `runFullSync` inclui o catálogo).

- [ ] **Step 2: Badge + botão na home (`index.tsx`)**

Adicionar import:

```ts
import { useSyncStore } from '../store/useSyncStore';
```

No componente, após `const { user, logout } = useAuthStore();`:

```ts
  const { pendingDiagnostics, pendingFeedbacks, pendingSlmLogs, isSyncing, syncNow, refreshCounts } = useSyncStore();
  const totalPending = pendingDiagnostics + pendingFeedbacks + pendingSlmLogs;
```

No `useFocusEffect`, chamar também `refreshCounts()`:

```ts
  useFocusEffect(
    useCallback(() => {
      loadData();
      refreshCounts();
    }, [])
  );
```

Adicionar handler após `handleAddMockDiagnostic`:

```ts
  const handleSyncNow = async () => {
    await syncNow({ manual: true });
    const { lastError } = useSyncStore.getState();
    await loadData();
    if (lastError) {
      Toast.show({ type: 'error', text1: 'Falha na sincronização', text2: lastError });
    } else {
      Toast.show({ type: 'success', text1: 'Sincronização concluída', text2: 'Dados enviados ao servidor.' });
    }
  };
```

Substituir o bloco `welcomeBanner` (o `<View style={styles.welcomeBanner}>` atual) por:

```tsx
              <View style={styles.welcomeBanner}>
                <View style={styles.welcomeTextBlock}>
                  <Text style={styles.welcomeTitle}>Olá, {user?.nome?.split(' ')[0] || 'Produtor'}</Text>
                  <Text style={styles.welcomeSubtitle}>
                    {totalPending > 0
                      ? `Você tem ${totalPending} ${totalPending === 1 ? 'item' : 'itens'} para sincronizar`
                      : 'Todos os dados sincronizados'}
                  </Text>
                  {totalPending > 0 && (
                    <Button
                      title={isSyncing ? 'Sincronizando...' : 'Sincronizar agora'}
                      onPress={isSyncing ? () => {} : handleSyncNow}
                      variant="primary"
                      style={styles.syncBtn}
                      textStyle={styles.mockAddBtnText}
                    />
                  )}
                </View>
                <Button
                  title="+ Novo Offline (Mock)"
                  onPress={handleAddMockDiagnostic}
                  variant="primary"
                  style={styles.mockAddBtn}
                  textStyle={styles.mockAddBtnText}
                />
              </View>
```

> Se o componente `Button` aceitar prop `disabled`, prefira `disabled={isSyncing}` ao guard no `onPress` — verificar `frontend/components/Button.tsx`.

Adicionar estilos ao `StyleSheet`:

```ts
  welcomeTextBlock: {
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  syncBtn: {
    height: 34,
    paddingHorizontal: theme.spacing.md,
    marginTop: theme.spacing.sm,
    alignSelf: 'flex-start',
  },
```

A variável local `pendingCount` e seu cálculo em `loadData` podem permanecer (usados em outros lugares) — apenas o texto do banner passa a usar o store.

- [ ] **Step 3: Verificação rápida de typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: sem erros novos (erros pré-existentes, se houver, anotar e não introduzir outros).

- [ ] **Step 4: Commit**

```bash
git add frontend/app/index.tsx frontend/app/_layout.tsx
git commit -m "feat(web): add sync badge, manual sync button and auto-sync on reconnect"
```

---

## Task 13: Verificação final (gates T5.1–T5.9)

- [ ] **Step 1: Suítes completas**

Run: `docker compose up -d && cd backend && npx vitest run && cd ../frontend && npx vitest run`
Expected: tudo PASS.

- [ ] **Step 2: Verificação manual T5.1 (upload real no MinIO)**

1. `docker compose up -d` (db + minio + minio-init)
2. `cd backend && npm run dev`
3. Obter token: registrar/login via curl ou app web.
4. `curl -X POST http://localhost:3000/api/v1/upload/url -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"filename":"teste.jpg","content_type":"image/jpeg"}'`
5. `curl -X PUT "<upload_url>" -H "Content-Type: image/jpeg" --data-binary @<qualquer-jpg>`
6. Conferir no console do MinIO (http://localhost:9001, minio_admin/minio_password) que o objeto existe em `plant-diagnostics/diagnosticos/...`

Expected: PUT retorna 200 e objeto aparece no bucket.

- [ ] **Step 3: Verificação manual T5.9 (badge + sync ponta a ponta no app web)**

1. `cd frontend && npm run web` (backend rodando)
2. Login → home → "+ Novo Offline (Mock)" 2-3x → badge mostra contagem
3. "Sincronizar agora" → toast de sucesso → badge some → cards mudam para "Enviado"
4. Conferir registros na tabela `diagnosticos` do Postgres

> NOTA: no web, mocks com URI `https://picsum.photos/...` dependem de CORS do picsum e do MinIO; se falhar, é esperado que o item permaneça PENDING (comportamento T5.8) — validar o fluxo completo preferencialmente com imagem mock `file://` em device/emulador, ou aceitar a validação dos endpoints via curl + testes de integração.

- [ ] **Step 4: Atualizar status e commitar fechamento**

```bash
git add -A
git commit -m "chore: complete Sprint 5 store-and-forward sync verification"
```

---

## Notas de execução

- **Pré-requisito de todos os testes backend:** Postgres do docker-compose rodando + `.env` com `DATABASE_URL`, `JWT_SECRET`, `LLM_API_KEY` e as novas vars S3.
- **Testes de integração compartilham o banco:** os arquivos novos fazem `db.delete(usuarios)` em `beforeAll` — rodar a suíte completa serialmente (vitest default por arquivo já isola).
- **Se `store.test.ts` quebrar na Task 7:** o handler genérico deve reproduzir o contrato dos antigos (defaults de `timestamp`); corrigir o handler, não o teste.
- **Ordem das tasks:** 1→6 backend, 7→12 frontend, 13 fecha. Tasks 8 e 9 dependem da 7; a 10 depende da 9; a 12 depende da 10.
