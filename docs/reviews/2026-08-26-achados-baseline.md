# Achados de Review — Baseline pré-reformulação

**Data:** 26/08/2026
**Commit de referência:** `b1e52af` (branch `review/sprint6-cross-validation`, PR #1)
**Origem:** ultrareview na nuvem sobre o PR #1 (7 achados) + `/code-review max backend/src` local (15 achados)

Levantado antes de iniciar a reformulação arquitetural, para separar bug pré-existente de regressão futura.

> Sobreposições: o item L6 é o mesmo que U3; o L12 é o mesmo que U4. Total de achados únicos: **20**.

---

## Prioridade 1 — corrigir antes de qualquer teste de campo

Independentes da reformulação: são correções pontuais em código que sobrevive a qualquer arquitetura escolhida.

### P1.1 — `doenca_id` nulo trava a fila de sync inteira
`frontend/lib/syncService.ts` · `backend/src/modules/sync/sync.schema.ts:12`

`Saudável` e `Fitotoxicidade` são gravados com `doenca_id = NULL` (`camera.tsx:397`). O `syncService` repassa o null sem fallback, mas o schema exige `z.string().uuid()`. O `.parse()` estoura no primeiro item inválido → **400 no lote inteiro** → até 49 diagnósticos válidos não sincronizam. Como o erro é anterior ao loop por item, eles nunca incrementam `retry_count` nem viram `FAILED`: ficam `PENDING` para sempre.

**Impacto:** a fila nunca mais drena. `Saudável` é provavelmente o resultado mais comum em campo. Dado de produtor, coletado sem sinal e irrecuperável, fica preso no aparelho.

**Correção:** filtrar especiais no payload do `syncService`, ou não inseri-los em `fila_diagnosticos`, ou tornar `doenca_id` nullable no schema.

### P1.2 — Nenhum rate limit por rota está ativo
`backend/src/app.ts:72, 84, 96, 108, 119`

Os limites são passados como `app.register(routes, { prefix, config: { rateLimit } })` — isso é opção **do plugin**, não **da rota**. O `@fastify/rate-limit` lê de `routeOptions.config.rateLimit`, preenchido apenas quando declarado na própria rota.

Reproduzido empiricamente com `fastify@5.8.5` + `@fastify/rate-limit@10.3.0`: `routeOptions.config` não contém `rateLimit`; toda resposta traz `x-ratelimit-limit: 60`.

| Rota | Pretendido | Real |
|---|---|---|
| `/auth/*` | 10/min | 60/min |
| `/chat/stream` | 20/min | 60/min |
| `/sync/*` | 30/min | 60/min |
| `/diagnosis/cross-validate` | 20/min | 60/min |

**Correção:** declarar `config.rateLimit` na definição de cada rota, dentro dos `*.routes.ts`.

### P1.3 — Veredito de cross-validation é forjável pelo cliente
`backend/src/modules/sync/sync.service.ts:85` · `cross-validation.service.ts:90-97`

`sync.schema.ts` aceita os cinco status incluindo os terminais. O **INSERT** de `sync.service.ts` grava `crossValidationStatus` e `llmObservacoes` direto do cliente, sem o guard `!hasServerResult` que a branch de UPDATE possui. Depois, `/diagnosis/cross-validate` faz short-circuit em `CONFIRMED|ENRICHED|DIVERGENT` e devolve o texto forjado como segunda opinião — sem carregar imagem nem chamar o LLM.

**Impacto:** permite burlar a invariante "nunca ocultar divergência" e contamina o loop de feedback do RF06, que alimenta a melhoria dos modelos. Num app onde a segunda opinião orienta aplicação de defensivo, é falha de integridade.

**Correção:** aplicar o guard `!hasServerResult` também no INSERT, ou rejeitar status terminais vindos do cliente.

### P1.4 — Carga de imagem do S3 sem limite de tamanho
`backend/src/modules/diagnosis/cross-validation.service.ts:36` · `upload.service.ts:14-18`

`S3DiagnosticImageLoader.load` bufferiza o objeto inteiro e faz base64 (~33% maior), sem cap de `ContentLength` e sem allowlist de `ContentType`. O presigned PUT não assina condição de tamanho, então o tamanho é totalmente controlado pelo cliente.

Combinado com **P1.2**, é DoS trivial: poucas centenas de MB esgotam a heap do container.

**Correção:** validar `ContentLength` via `HeadObject` antes do `GetObject`, e impor teto no loader.

---

## Prioridade 2 — tocam os eixos da reformulação

Vale decidir junto com o novo desenho de captura e sync, para não refazer trabalho.

### P2.1 — Retake deixa diagnóstico órfão *(regressão deste PR)*
`frontend/app/camera.tsx:283-311, 466`

O INSERT saiu de `handleSaveToHistory` (acionado pelo usuário) para `persistDiagnosticAndStartCrossValidation` (automático pós-inferência). `handleResetCamera` limpa apenas state do React — não faz `DELETE`. Cada tentativa descartada vira linha no servidor **e upload no S3**. A documentação registra que o produtor precisa de 3–5 tentativas para obter um bom frame.

**Compõe com P1.1:** basta um órfão ser `Saudável` para envenenar o lote.

### P2.2 — Falha de cross-validation deixa `PENDING` → loop de retry pago
`backend/src/modules/diagnosis/cross-validation.service.ts:112`

Timeout (504), erro de provider (502) e JSON inválido (502) retornam antes do `saveResult`, deixando o status em `PENDING` — que não está no conjunto terminal. O cliente offline-first re-tenta indefinidamente, cada ciclo custando um `GetObject` mais uma inferência de visão. Além disso, `withTimeout` não usa `AbortSignal`: o prazo de 15s para o servidor de esperar, mas não cancela nem para de cobrar a requisição upstream.

### P2.3 — `/sync/diagnostics` não revalida o prefixo do `image_s3_key`
`backend/src/modules/sync/sync.service.ts:20-49`

A cross-validation valida `diagnosticos/{userId}/`; o sync aceita a chave do cliente verbatim, em ambas as branches. A branch de UPDATE, nova neste PR, ampliou a exposição. Hoje nenhum endpoint devolve a chave, então não há vazamento — mas a invariante que o resto do PR estabelece fica quebrada.

> O review local marcou como refutado, porém refutou outra afirmação: que o *gerador* produz o prefixo correto (produz). O achado do ultrareview permanece válido.

### P2.4 — UPDATE grava `doencaId` antes do gate de catálogo
`backend/src/modules/sync/sync.service.ts:39`

A validação de existência da doença (linhas 58-68) agora cobre só o INSERT. Um re-envio com `doenca_id` fora do catálogo bate na FK, e o catch genérico devolve `SYNC_ITEM_ERROR` com o texto cru do Postgres em vez do `INVALID_DOENCA_ID` documentado. O cliente re-tenta, falha igual, e após `MAX_RETRIES` marca `FAILED` permanentemente.

### P2.5 — `new Date(item.timestamp)` no UPDATE pode lançar `RangeError`
`backend/src/modules/sync/sync.service.ts:43`

`sync.schema.ts:8` declara `timestamp: z.string()` sem `.datetime()`. Um valor como `'20/07/2026 12:00'` produz `Invalid Date`, e o serializador do drizzle chama `.toISOString()` → `RangeError: Invalid time value`. Converte um diagnóstico já persistido corretamente em `failed_items`, e a fila re-tenta para sempre.

### P2.6 — `llmDoencaId` gravado sem validação de catálogo
`backend/src/modules/sync/sync.service.ts:82`

É foreign key, mas vai direto do corpo da requisição, enquanto o irmão `ai_result.doenca_id` no mesmo insert é validado. UUID aleatório → violação de FK e item descartado; id real porém desativado → FK passa e a linha referencia doença que o `CrossValidationService` teria normalizado para null.

---

## Prioridade 3 — corretude e operação

### P3.1 — `extractJson` quebra com prosa após o JSON
`cross-validation.service.ts:47` — a varredura primeiro-`{` / último-`}` engloba comentário final do modelo. Atinge o Claude especificamente: só o Gemini seta `responseMimeType: 'application/json'`. Verdicto válido vira 502 e a inferência paga é descartada. `LLM_MAX_TOKENS` é 2048 enquanto `llm_observacoes` permite 8000 chars, sem checagem de `stop_reason`.

### P3.2 — `createPending` sem try/catch pode virar 500
`cross-validation.service.ts:99` — `mobile_local_id` tem constraint unique **global**, mas `findDiagnostic` filtra por `(userId, mobileLocalId)`. Double-tap ou local_id de outro usuário → 23505 cru → 500 em vez do 200 idempotente que o endpoint promete.

### P3.3 — Rate limit chaveia por IP, não por usuário
`app.ts:48` — sem `keyGenerator` e sem `trustProxy`. Atrás de proxy, toda a base compartilha um balde; sem proxy, um usuário rotacionando IP (normal em rede móvel) não tem teto por conta.

### P3.4 — Erro local mascarado como `LLM_UNAVAILABLE`
`frontend/lib/crossValidationService.ts:59-88` — o try/catch envolve o `api.post` **e** o UPDATE no SQLite. Falha de FK local (catálogo desatualizado) vira `LLM_UNAVAILABLE`, o cliente marca `SKIPPED`, e o guard do servidor impede a auto-correção: cliente e servidor divergem permanentemente.

### P3.5 — Migration v5 backfilla linhas legadas como `PENDING`
`frontend/db/sqlite.ts:530-549` — `ADD COLUMN NOT NULL DEFAULT 'PENDING'` preenche todas as linhas pré-existentes. Como não é null, o fallback `?? 'SKIPPED'` do `syncService` nunca dispara, e diagnósticos legados chegam ao servidor como `PENDING` eternamente. Deveriam ser `SKIPPED`.

### P3.6 — Retry idempotente perde `llm_doenca_nome`
`cross-validation.service.ts:138` — não há coluna para o nome; fora do catálogo, a primeira resposta devolve a string do LLM e a segunda devolve `null`. Quebra o contrato de idempotência.

### P3.7 — `lat=0/lng=0` (Null Island)
`cross-validation.repository.ts:56` — sentinela em colunas `NOT NULL` quando o cross-validate precede o sync. O fluxo normal se auto-corrige, mas diagnóstico cujo sync nunca chega fica no Golfo da Guiné, indistinguível de leitura real.

### P3.8 — Log de erro descarta mensagem e stack
`app.ts:189` — registra só `error.name` e `error.code`. O bloco `redact` do pino adicionado para justificar isso é incompleto: o wildcard `*` casa exatamente um nível, então `{access_token}` no topo e `{res:{payload:{access_token}}}` vazam em texto claro. Um `TypeError` em produção loga `{errorName:'TypeError', errorCode:undefined}` sem forma de localizar o código.

### P3.9 — `run-seed.ts` engole erro e sai com código 0
`run-seed.ts:64` — sem rethrow e sem `process.exitCode`. Uma cadeia `db:migrate && db:seed && start` prossegue com catálogo pela metade. O script irmão `audit-s3-security.ts` seta `exitCode = 1` — a assimetria é claramente acidental.

### P3.10 — Validação duplicada no controller
`cross-validation.controller.ts:8` — `safeParse` mais mapeamento ZodError refazendo à mão o que `app.ts:151-165` já faz, divergindo do padrão dos outros cinco controllers. Junto: `cv_result.doenca_nome` é obrigatório no schema e nunca lido pelo serviço.

---

## Refutados pelo review local

Investigados e descartados com evidência:

- Travessia de path via `..` no `image_s3_key` — S3 e MinIO tratam chaves como strings opacas
- `withTimeout` gerando unhandled rejection — `Promise.race` anexa handlers a ambas
- Match `undefined === undefined` no nome da doença — `disease.nome` é sempre string
- Estreitamento de tipos no SDK da Anthropic e `superRefine` do Zod — `tsc --noEmit` passa limpo sob `strict: true` (zod v4.4.3)
- Escopo de usuário no sync de feedback — já é user-scoped
- `preHandler: [authenticate]` — é a convenção estabelecida nos seis módulos de rota

## Cortados pelo teto de 15 itens (nível limpeza)

- Literal `['CONFIRMED','ENRICHED','DIVERGENT']` duplicado em dois serviços, embora `cvStatusEnum` já exista em `schema.ts:23`
- `listActiveDiseases()` faz select de tabela inteira sem limite e interpola o catálogo completo em todo prompt, sem cache
- `toResponse` versus o literal inline em `cross-validation.service.ts:142-153` — duas formas do mesmo DTO mantidas à mão

---

---

## Status de resolução — 09/09/2026

Todos os 20 achados foram corrigidos na branch `fix/review-findings`, em quatro
commits, com teste que falha antes da correção para cada um.

| Commit | Achados |
|---|---|
| `3d1af31` fix(sync) | P1.1, P1.3, P2.3, P2.4, P2.5, P2.6 |
| `5d689ba` fix(backend) | P1.2, P3.3, P3.8 |
| `64d0e9a` fix(diagnosis) | P1.4, P2.2, P3.1, P3.2, P3.6, P3.7, P3.9, P3.10 |
| `a3cfba7` fix(frontend) | P2.1, P3.4, P3.5 |

Testes: backend 46 → 65, frontend 49 → 54. Typecheck e build limpos nos dois.

### Decisões que foram além da correção pontual

- **`doenca_id` e coordenadas viraram nullable** no Postgres. Descartar
  diagnósticos especiais jogaria fora dado real de campo, que é o que o RF05
  existe para preservar; e (0,0) é um ponto real no Golfo da Guiné.
- **Lote de sync ficou resiliente por item.** Corrigir só o nulo deixaria a
  fila igualmente frágil a qualquer incompatibilidade futura.
- **Nova coluna `llm_doenca_nome`**, para não perder o que o LLM afirmou quando
  a doença está fora do catálogo — a RF08 proíbe ocultar divergência.
- **Rate limit desligável por `RATE_LIMIT_ENABLED`**, ligado por padrão.
- **`lib/diagnosticDraftService.ts` extraído** de `camera.tsx`, que não tem
  cobertura de teste.

### Bug latente descoberto durante a correção

O `errorResponseBuilder` do rate limit devolvia um objeto sem `statusCode`,
então exceder o limite virava **500 genérico em vez de 429**. Ficou invisível
enquanto os limites nunca disparavam (P1.2).

### Fora do escopo destes commits

- **CI do frontend quebrado** (`build:web`): `react-native-vision-camera@5.0.11`
  publica import sem extensão (`./VisionCamera`), inválido em ESM, e o
  `expo export --platform web` carrega isso pelo loader ESM do Node 22. Passa
  localmente no Node 26. Não estava entre os achados e não foi tocado.
- Varredura de `frontend/lib`, `frontend/db` e `frontend/app` no código antigo.

## Cobertura

| Área | Status |
|---|---|
| `backend/src` | ✅ ultrareview + `/code-review max` |
| `frontend/` (diff do PR) | ✅ ultrareview |
| `frontend/lib`, `frontend/db`, `frontend/app` (código antigo) | ❌ **sem varredura** |

O `camera.tsx` de 1.969 linhas e o `WebDatabaseDriver` só foram vistos pelo ultrareview na parte que o diff tocou. Rodar `/code-review max frontend/lib frontend/db` antes de mexer na arquitetura do cliente.

## Estado do PR #1

- Comentário do ultrareview postado em 26/08/2026 19:07
- CI: **backend passou**, **frontend falhou** (`33000005057`)
- Draft, não mergeado
