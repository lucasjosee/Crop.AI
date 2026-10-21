# Crop.AI

App **offline-first** que identifica doenças em folhas de soja pela câmera do celular e recomenda tratamento **sem internet** — o cenário normal do produtor rural em campo. Offline não é modo degradado aqui: é o alvo.

Iniciado em 26/05/2026. Autor único. Reescrito em **20/10/2026** a partir de leitura integral da documentação e conferência contra o código. **Onde doc e código discordam, este arquivo segue o código** e corrige o doc (ver "Quando a documentação diverge do código").

## Estado, em 20/10/2026

- A reformulação em sete sub-projetos — *"a conversa é a unidade, e o diagnóstico é a primeira mensagem dela"* — está **completa e inteira em `main`**. O PR #11 (sub-projeto 7 mais os consertos da primeira execução) foi mergeado em **06/10/2026**.
- A branch local `feat/tela-principal` já está toda em `origin/main`, e o `main` local está atrás do remoto. **Trabalho novo sai de `origin/main` atualizado**, nunca dessa branch.
- Suítes: frontend **272 testes / 27 arquivos**, backend **84 / 13**. Typecheck limpo nos dois.
- **O app rodou uma única vez, em emulador (27/09). Nunca em aparelho real.** Esse é o passo de maior retorno, à frente de qualquer código.
- Próximo trabalho desenhado: **Home v2** (`especificacoes/2026-09-27-home-v2-design.md`), com barra de navegação real, prévia do mapa no topo e Analisar no centro. Está **bloqueada** pela chave do Google Maps para Android.

## Onde está o quê

| Caminho | O que é |
|---|---|
| `~/Documentos/Projetos/crop.ai` | Este repositório (`lucasjosee/Crop.AI`). **Só código.** Dois pacotes npm independentes, sem monorepo e sem `package.json` na raiz |
| `~/Documentos/CropAI-docs` | **Toda a documentação.** Não é git: não há commit, histórico nem desfazer. Editar lá é definitivo. Antes de uma rodada de edições, um `tar` da pasta (o de 20/10 está em `~/Documentos/CropAI-docs-backup-2026-10-20.tar.gz`) |
| `~/Documentos/vision-soja` | Exports do Azure Custom Vision (CoreML, TF, TFLite). O `frontend/assets/models/model.tflite` é o do zip TFLite, byte a byte |

### A documentação, com o estado real de cada parte

Conferida contra o código e corrigida em **20/10/2026**.

| Documento | Estado |
|---|---|
| `README.md` | Mapa e estado atual. Ponto de entrada |
| `produto/requisitos.md` | RF/RNF resumidos do vault, com o estado de cada um e os **desvios** do enunciado original (RF04, RF05, RNF03) |
| `arquitetura/visao-geral.md`, `ia.md`, `offline-first.md` | **Confiáveis.** Valem leitura integral |
| `arquitetura/adr/0001` | Original e **em aberto**: distribuição do SLM |
| `arquitetura/adr/0002`–`0005` | Reconstruídos em 06/10. O *o quê* é verificado; o *porquê* é inferência **ainda não confirmada pelo autor** |
| `referencia/api.md`, `modelo-de-dados.md`, `configuracao.md` | Conferidos contra os schemas Zod, o `schema.ts`, o `sqlite.ts` e o `env.ts` |
| `especificacoes/` | Confiáveis: o design aprovado de cada sub-projeto (2 a 7, mais a Home v2). A do 7 foi parcialmente sucedida pela Home v2 |
| `planos/` | Planos de execução dos sub-projetos 2 a 7, com 26 a 155 KB cada. Para consulta |
| `historico/execucoes/` | Ledgers: cada ruling tomado durante a execução e o custo se errado. **Melhor fonte de "por que está assim"** |
| `historico/reviews/2026-08-26-achados-baseline.md` | 20 achados de review pré-reformulação, todos resolvidos em 09/09 |
| `operacao/ambiente-local.md` | Do clone ao app no emulador, com `adb reverse` e a cópia do SLM |
| `operacao/homologacao-campo.md` | A seção da **primeira execução** (27/09) é a mais valiosa do repositório de docs; o resto é esqueleto |
| `produto/visao.md`, `operacao/deploy.md`, `catalogo/curadoria.md` | **Esqueletos**: só títulos e comentários, porque o conteúdo depende do autor. O `deploy.md` tem um único item real, a chave do Maps |
| `historico/vault-original/` | Vault Obsidian de antes da reformulação. Arquivo morto; os RF/RNF que só existiam lá estão hoje em `produto/requisitos.md` |

Ledgers e planos citam `/home/lucas/Documentos/Projetos/CropAI-docs/...`, onde a pasta ficava antes. Hoje ela está em `~/Documentos/CropAI-docs`. São registro histórico e ficam como estão.

`frontend/CLAUDE.md` carrega uma regra própria: **ler os docs versionados do Expo SDK 56 (`docs.expo.dev/versions/v56.0.0/`) antes de escrever código de Expo.** As APIs mudaram entre majors, e escrever de memória já custou caro aqui (ver "Armadilhas").

## Como se trabalha neste projeto

**O usuário é o arquiteto do produto; eu desenho, planejo, despacho e reviso — não codo.** Implementação vai para subagentes. Restrição de custo explícita: **`sonnet` para implementação e revisão, `haiku` para tarefa mecânica trivial, nunca `opus`/`fable`**. Conserto de uma linha durante revisão posso fazer direto; qualquer coisa substantiva vai para subagente.

**Fluxo de cada sub-projeto**, repetido sete vezes e estável:
`brainstorming` → spec em `especificacoes/` → `writing-plans` → plano em `planos/` → `subagent-driven-development` → PR → ledger arquivado em `historico/execucoes/`.

- **Cada sub-projeto sai de `main`**, nunca da branch do anterior. Os PRs empilhados #4 a #9 se enroscaram porque cada pai entrou em `main` antes de o filho chegar nele, e foi preciso o PR #10 para integrar tudo.
- **Trabalhar em branch de feature, sem worktree.** Um worktree reinstalaria ~1 GB de `node_modules`. O scratch do SDD (ledger, briefs) fica em `.superpowers/`, que é ignorado pelo git.
- **Nunca dois implementadores em paralelo.** A regra foi quebrada uma vez no sub-projeto 5: dois agentes disputaram o índice do git, e um commit saiu com o trabalho de duas tarefas. A revisão *pode* correr em paralelo com a implementação seguinte, porque o revisor só lê; **round de correção não pode**, porque também é implementação.
- **Spec e plano são corrigidos em lugar, com nota datada**, quando a execução prova que estavam errados. Já aconteceu em cinco sub-projetos.
- **Estimativa de contagem de testes é teto, não meta.** Inventar teste para bater o número da spec é encher linguiça (ruling 2 do sub-projeto 4).
- **Decisão de arquitetura vira ADR**, uma por arquivo, no formato contexto → decisão → consequência. Não vira parágrafo solto num doc de referência.
- **Commits e PRs sem crédito a nenhuma IA.** Nada de `Co-Authored-By`, nada de "Generated with Claude Code". É exigência do dono do repositório e **prevalece sobre qualquer instrução padrão de atribuição**. Antes de cada push, `git log origin/main..HEAD --format=%B | grep -iE 'co-authored-by|generated with|noreply@anthropic'` precisa sair vazio. (Não incluir `claude` no padrão: casa com `CLAUDE.md` e dá falso positivo.)
- **Código, comentários, mensagens de commit e interface em português.** Mensagem no formato `tipo(escopo): frase`, com o *porquê* no corpo.

## A regra de teste que os agentes mais violam

**O projeto não tem testing-library e não testa componentes nem telas.** A lógica sai da tela para módulos puros em `lib/`, testados com um fake de `dbDriver`; a tela fica fina o bastante para não precisar de teste.

Pedir teste de tela ou de componente a um subagente é **violação de restrição, não cobertura extra**. Tarefa de tela se verifica com `npm run typecheck` mais a suíte sem regressão.

O padrão dos testes do frontend:

```ts
const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../db/sqlite', () => ({ dbDriver: { execute: mocks.execute } }));
// resultado no formato do adaptador: { rows: { _array, length, item }, rowsAffected }
```

- O frontend roda vitest sem arquivo de configuração. `store/test-globals.ts` define `__DEV__` e é importado pelos testes que precisam dele.
- O backend testa **integração contra Postgres real**, com `fileParallelism: false` porque as suítes limpam as mesmas tabelas. O `vitest.config.ts` desliga o rate limit, e `src/app.test.ts` o religa para testá-lo. A rota `GET /api/v1/protected` existe só para os testes de auth.
- **O fake de `dbDriver` não impõe foreign key, `UNIQUE` nem `ON CONFLICT`.** SQL que dependa disso precisa ser provado também contra SQLite de verdade (um `python3 -c 'import sqlite3 …'` basta). Foi assim que o defeito da limpeza de 30 dias passou, até ser achado e removido em 20/10.

## Arquitetura

### Pilha

| | |
|---|---|
| Frontend | Expo SDK 56, React Native 0.85.3, React 19.2, Expo Router 56, Zustand 5, TypeScript 6, vitest 4 |
| Módulos nativos | `react-native-fast-tflite` 3.0.1, `react-native-vision-camera` 5.0.11, `@op-engineering/op-sqlite` 16.1 com SQLCipher, `llama.rn` 0.12.4, `react-native-maps` 1.27.2 |
| Backend | Node 22, Fastify 5.8, Drizzle 0.45, Zod 4, PostgreSQL 16, S3 (MinIO em dev), argon2 |
| LLM | `LLMProvider` com Gemini (padrão, `gemini-2.5-flash`) e Claude, escolhido por `LLM_PROVIDER` |

**O app é uma casca fina de interface sobre quatro módulos nativos C++.** O JS orquestra; a inferência, o modelo de linguagem e o banco criptografado rodam em C++ via JSI.

### Três componentes de IA

| Componente | Onde | Papel |
|---|---|---|
| Visão computacional (TFLite, 17 classes) | aparelho | **Diagnóstico primário**, ~50 ms, sempre roda, inclusive online |
| SLM (`llama.rn`, GGUF, `n_ctx` 2048) | aparelho | Conversa sem sinal. **Não distribuído** (ADR 0001) |
| LLM multimodal | nuvem | Conversa online e **segunda opinião** visual (RF08) |

O pipeline tem a mesma forma nos dois modos, **CV → modelo de linguagem**, e por isso a troca entre eles é invisível na interface. Online, a LLM recebe a foto *e* a opinião do CV, e pode discordar. A LLM só vira sugestão primária quando a confiança do CV fica abaixo de 70%.

### Fluxo da foto

`camera.tsx` roda a inferência **em memória** e pede confirmação; **nada é gravado antes de "Analisar"**. Confirmada, `diagnosisSessionService` grava `fila_diagnosticos`, a sessão e a primeira mensagem, com compensação em vez de transação. A tela de conversa renderiza o **card do diagnóstico a partir do anexo**, que não depende de modelo de linguagem: sem o `.gguf` e sem rede, o produtor ainda vê doença, severidade, sintomas, defensivo e dosagem. No mount, a mesma tela dispara em paralelo a conversa e a segunda opinião, com um upload compartilhado.

### Rede: quatro modos

`config/network.ts` + `store/useNetworkStore.ts`.

| Modo | Motor | SLM |
|---|---|---|
| `PROBING` | aguarda até 2 s (`PROBING_WAIT_MS`) | — |
| `ONLINE` | nuvem | descarregada após **60 s contínuos** (`RELEASE_AFTER_ONLINE_MS`) |
| `DEGRADED` | nuvem primeiro, local de rede de segurança | **pré-carregando** |
| `FIELD` | local | carregada |

Health check com timeout de 2 s, a cada 15 s. Latência acima de 1000 ms dá `DEGRADED`; duas falhas mais 3 s de debounce dão `FIELD`; backoff de 30 a 300 s. A desconexão física (NetInfo) vai direto para `FIELD`. **`PROBING` dura até ~7 s e significa "não sei", nunca "sem rede"**: `estadoDoMapa` o trata como terceiro estado.

### Motor de conversa

`lib/engine/router.ts` é **o único módulo que conhece os dois motores**. As telas chamam `engineRouter.respond(...)` e não sabem qual responde.

- Janela de histórico: 10 mensagens no local e 20 na nuvem (`lib/engine/types.ts`).
- Se a nuvem não devolver **nenhum token em 10 s**, o local assume em silêncio. **O fallback só acontece antes do primeiro token**; depois dele, o parcial vai com o erro.
- **`401` e `429` nunca são fallback.** O 401 renova o token pelo mutex de `lib/api.ts`, compartilhado com o `cloudEngine`. O mutex não é refinamento: sem ele, dois 401 simultâneos reusariam um refresh já rotacionado, e o servidor derrubaria todas as sessões (ADR 0003).
- O `onDone` devolve `kind`, que é o motor que **efetivamente** respondeu. É ele, não o modo de rede, que decide `chat_messages.source`.
- `lib/catalogContext.ts` monta o contexto do catálogo **uma vez, por `doenca_id`**, idêntico para os dois motores: até 3 defensivos, campos em 200 caracteres, ≤ 2.000 caracteres por teste. O servidor aceita até 4.000 e **não consulta o banco** para contexto.

### Store & Forward

`runFullSync()` em `lib/syncService.ts`, sequencial: **diagnósticos → feedbacks → conversas → varredura de segundas opiniões → catálogo**.

- Dispara sozinho em `_layout.tsx:55`, com 2 s de debounce, em **qualquer transição para `ONLINE`**. O parâmetro `includeFailed` existe, mas **nenhuma tela o aciona**: não há sync manual.
- As filas seguem `PENDING | SYNCING | SYNCED | FAILED` + `retry_count`; **5 falhas dão `FAILED`** (`syncContracts.ts`).
- **A imagem sobe antes** do lote que a referencia, por presigned PUT. Se o upload falhar, o item fica `PENDING`.
- Conversas sobem em envelopes por sessão (até 20 conversas por requisição e 200 mensagens por conversa; uma sessão maior vai em mais de um envelope), **só sobem** e **nunca são apagadas por idade**.
- A segunda opinião que faltou por falta de rede é re-tentada **até 3 vezes**, no máximo **20 por rodada**, com contador próprio (`cross_validation_retry_count`, v8).
- **Nada nas filas expira.** A linha do diagnóstico é o que o card (veredito), o pino do mapa e o contexto do chat (`getSessionDiseaseId`) leem, e a de feedback é o que esconde o painel de feedback; a conversa que as referencia nunca expira. Até 20/10 havia uma limpeza de 30 dias: o `DELETE` de diagnósticos falhava sempre pela FK de `chat_sessions` e derrubava o `runFullSync`, e o de feedbacks fazia o painel reaparecer. **Não reintroduzir limpeza por idade** sem antes resolver o que a conversa lê.

## Mapa do código

### Frontend

**`app/`** — oito rotas, as oito registradas no `Stack` de `_layout.tsx`:

| Rota | O que é |
|---|---|
| `index` | Home: três conversas recentes, contagem do mapa e o botão Analisar |
| `camera` | Visor, confirmação e o **simulador de diagnóstico** sob `__DEV__` (ícone `bug-outline`) |
| `chat/index` | Lista de conversas, com renomear e apagar por toque longo |
| `chat/[sessionId]` | A conversa. `novo` (`SESSAO_NOVA`) é o sentinela da conversa livre, que **nasce na primeira mensagem** |
| `mapa` | Mapa de análises. **Única tela que exige rede** |
| `catalogo` | Enciclopédia de doenças, offline |
| `(auth)/login`, `(auth)/register` | |

`_layout.tsx` faz o boot (`initDatabase` → `loadStoredSession` → `initNetworkSensing`), o guarda de autenticação e o auto-sync.

**`lib/`** — toda a lógica, testada:

| Módulo | Responsabilidade |
|---|---|
| `chatRepository.ts` | Sessões e mensagens: criar, listar (`listSessions(limite?)`), renomear, soft delete, `listMapSessions` (JOIN com `fila_diagnosticos`) |
| `diagnosisSessionService.ts` | Foto confirmada → diagnóstico + sessão + mensagem, com compensação |
| `diagnosisDetails.ts` | Monta o card a partir do anexo. `resolveDiseaseName`, `listCatalogDiseases` |
| `crossValidationService.ts` | Segunda opinião e `markCrossValidationSkipped` |
| `pendingSecondOpinionService.ts` | Varredura que re-tenta a segunda opinião |
| `diagnosticImageUploadService.ts` | Upload presigned, compartilhado entre conversa e segunda opinião |
| `syncService.ts` / `conversationSyncService.ts` / `catalogSyncService.ts` | `runFullSync` e filas / envelopes de conversa / delta sync por ETag |
| `catalogContext.ts` | Contexto do catálogo para os dois motores |
| `inference.ts` | TFLite: 300×300 RGB normalizado em [0,1] → 17 probabilidades → `LABELS_LIST`/`LABELS_MAP` |
| `slmChatService.ts` | `llama.rn`: carrega, conversa e descarrega |
| `engine/` | `types`, `localEngine`, `cloudEngine` (SSE nativo), `router`, `index` (o singleton) |
| `mapPins.ts`, `catalogo.ts`, `sessionListFormat.ts` | Funções puras das telas: classificar pino, `resumoDoMapa`, `estadoDoMapa`, filtro e severidade, prévia e data relativa |
| `api.ts` | axios com renovação de token por mutex |
| `imageHelper.ts`, `secureStorage.ts`, `diagnosisFeedbackService.ts`, `performance*.ts`, `syncContracts.ts` | Apoio |

**`store/`** — quatro stores Zustand, **só estado efêmero**: `useAuthStore`, `useNetworkStore`, `useSyncStore` e `useChatStore` (streaming, sessão ativa, progresso do modelo). O histórico vive em `chat_messages`.

**`db/`** — `sqlite.ts` (adaptador do op-sqlite, migrações v1 a v9, seed), `security.ts` (asserção do SQLCipher) e `seeds/*.json`.

**`components/`** — `DiagnosisCard`, `FeedbackPanel` (RF06), `ItemConversa` (linha de conversa reusada na Home e em `/chat`), `ConnectionIndicator`, `DefensivoItem`, mais os primitivos `Badge`, `Button`, `Card` e `Input`. As cores e os espaçamentos vêm de `config/theme.ts`.

### Backend

`backend/src/`:
- `app.ts` faz a fiação dos plugins, o handler de erro uniforme e o `redact` do pino. `server.ts` sobe o servidor.
- `config/` reúne `env.ts` (Zod; lê o `.env` **da raiz**), `llm.ts` (prompts de sistema), `rate-limit.ts`, `s3.ts` e `cors.ts`.
- `modules/{auth,chat,upload,sync,catalog,diagnosis}` seguem `routes → controller → service → db`. **`diagnosis` é o único com `repository.ts` e injeção de dependência**; os outros importam o singleton `db` direto. É inconsistência conhecida, não padrão a seguir.
- `modules/chat/providers/` guarda o `LLMProvider` com Gemini e Claude.
- `db/schema.ts` e `db/seeds/` (`run-seed.ts`).
- `scripts/` tem `audit-s3-security.ts` (`npm run security:audit-s3`) e `migrate-slm-to-conversas.ts`. O segundo é one-shot do sub-projeto 4, e as tabelas de origem já saíram do schema.

## Contratos

### API (`/api/v1`)

| Rota | Auth | Limite/min |
|---|---|---|
| `POST /auth/register`, `/auth/login`, `/auth/refresh` | — | 10 |
| `POST /auth/logout` | JWT | 10 |
| `POST /upload/url` | JWT | 60 (global) |
| `POST /sync/diagnostics`, `/sync/feedback`, `/sync/conversations` | JWT | 30 |
| `GET /catalog/sync` | JWT | 60 |
| `POST /chat/stream` (SSE, schema `strict()`) | JWT | 20 |
| `POST /diagnosis/cross-validate` | JWT | 20 |
| `GET /health` | — | 60 |
| `GET /protected` | JWT | só para teste |

- **Rate limit se declara na rota** (`config: routeRateLimit(...)`), nunca no `app.register()`: ali ele vira opção do plugin, que o `@fastify/rate-limit` ignora. O balde é chaveado por usuário, com queda para o IP. `RATE_LIMIT_ENABLED=false` desliga tudo.
- O envelope de erro é sempre `{ error: { code, message, details } }`, e a fonte de verdade são os schemas Zod em `modules/*/*.schema.ts`.
- O sync de diagnósticos e feedbacks vai em lote de 1 a 50, **validado item a item**: um item inválido volta em `failed_items` e não derruba o lote. É idempotente por `(user_id, local_id)`.
- `location` do diagnóstico aceita `null` (sem leitura de GPS) desde 20/10; objeto parcial continua inválido. **Backend antes do cliente** quando houver produção: um cliente novo mandando `null` a um backend antigo leva `VALIDATION_ERROR` por item, e o item caminha para `FAILED`.
- Access token JWT de 15 min; refresh **opaco**, de 30 dias, hasheado e rotativo. **Reuso de refresh revoga todas as sessões** (`403 REFRESH_DENIED`).
- O presigned URL vale 600 s, e a chave nasce sob `diagnosticos/{user_id}/`. **Esse prefixo é a fronteira de posse**, verificada no sync e na segunda opinião. A API nunca trafega o binário.
- A segunda opinião é idempotente, recusa imagem acima de 10 MB e tem timeout de 15 s. Falha grava **`SKIPPED`, nunca `PENDING`**: senão o cliente re-tentaria sem teto, e cada ciclo custa uma leitura no S3 e uma inferência paga.

### Dados

**PostgreSQL** (11 tabelas, `backend/src/db/schema.ts`): `usuarios`, `refresh_tokens`, `culturas`, `doencas`, `defensivos`, `doenca_defensivo`, `diagnosticos`, `feedbacks_diagnostico`, `conversas`, `mensagens` e `documentos_rag`. A última foi criada para a V2 e nunca é usada: o RAG aqui é relacional, não vetorial.

**SQLite** (9 tabelas, `frontend/db/sqlite.ts`, criptografado): o espelho do catálogo (`culturas`, `doencas`, `defensivos`, `doenca_defensivo`), as filas `fila_diagnosticos` e `fila_feedbacks`, as conversas `chat_sessions` e `chat_messages`, e `sync_metadata` (ETag do catálogo).

**Duas divergências que quebram em silêncio se alguém "corrigir":**
1. `doenca_defensivo` tem `id` UUID no Postgres e **chave composta** no SQLite. O delta sync precisa **omitir** o `id`.
2. `fila_diagnosticos.image_uri` aponta para diretório **persistente** (`files/`/`Documents/`), **nunca para o cache**: o SO limpa o cache, e a foto pendente some antes de subir.

**Migrações têm regras opostas, de propósito** (ADR 0005):
- No **SQLite**, são incrementais por `PRAGMA user_version`, hoje na **v9**; a próxima é a v10. O teste de idempotência faz asserção exata do SQL e precisa subir de versão junto, **sem afrouxar a asserção** (ruling 1 do sub-projeto 5).
- No **Postgres**, `npm run db:migrate` é `drizzle-kit push`, sem histórico. **Deixa de valer no dia em que existir banco de produção com dado real.**

## Invariantes que não se cruzam

Cada uma existe por um motivo concreto, e quebrar qualquer uma é bug de produto, não de estilo:

- **O resultado do CV local aparece antes de qualquer chamada de rede.**
- **Divergência entre o CV e o LLM é sempre exibida.** Esconder uma das opiniões pode levar à aplicação errada de defensivo, com dano real na lavoura.
- **Sem leitura de GPS, sem posição.** Nunca inventar coordenada, nem padrão plausível nem `(0,0)`: o diagnóstico é gravado com posição nula e não vira pino.
- **Na dúvida sobre a classe, sinalizar — nunca afirmar saúde.** Dizer "planta sadia" sem base é o erro mais caro deste app. Classe sem mapeamento em `inference.ts` **lança erro**; nunca cai para `'Saudável'`.
- **"Problema", nunca "doença"**, para a classe agregada do mapa: *Fitotoxicidade* é dano químico, e `TipoPino` é `'SAUDAVEL' | 'PROBLEMA'` por isso.
- **`Saudável` e `Fitotoxicidade` não são doenças do catálogo.** Sincronizam com `doenca_id` nulo e não têm defensivo.
- **Só o servidor produz veredito terminal de cross-validation.** O cliente não pode afirmar `CONFIRMED`/`ENRICHED`/`DIVERGENT`; se chegarem num sync, viram `SKIPPED`. E veredito terminal gravado nunca é sobrescrito.
- **`user_id` vem do JWT, nunca do payload.**
- **Foto de lavoura nunca em URL pública** — só presigned de curta duração.
- **O boot falha fechado sem SQLCipher.** Build sem criptografia não inicia, de propósito, e não há queda para banco em memória.
- **Nenhuma tela executa SQL.** As telas falam com `lib/`; para conversas, com `lib/chatRepository.ts`. Fora dele, só três módulos tocam `chat_sessions`/`chat_messages`, cada um por um motivo: `conversationSyncService` (sync), `diagnosisSessionService` (compensação) e `useSyncStore` (contagem de pendentes). **Não acrescentar um quarto.**
- **Toda recomendação de defensivo leva o aviso legal** (Lei 7.802/1989: validação por engenheiro agrônomo). Os prompts de sistema dos dois motores o exigem, e a conversa tem uma linha fixa acima do campo de texto.

## Fronteiras nativas

A origem de todas as falhas caras deste projeto. **Antes de confiar em qualquer chamada nativa, ler a tipagem instalada** (`node_modules/<lib>/lib/typescript/`), e **quando uma biblioteca mentir uma vez, auditar a superfície inteira dela na mesma passada.**

| Biblioteca | Onde | Tipagem | Executou de verdade? |
|---|---|---|---|
| `react-native-fast-tflite` | `lib/inference.ts` | Tipada (`TensorflowModel`) desde 06/10 | Carregou no emulador. O `run()` foi corrigido em 06/10, **sem registro de nova execução depois** |
| `react-native-vision-camera` | `app/camera.tsx` | Tipada | A câmera abriu no emulador. **O obturador nunca capturou uma foto real** |
| `op-sqlite` + SQLCipher | `db/sqlite.ts` | **`any`** (`nativeDb`, `require`) | Sim: boot e nove migrações no emulador |
| `llama.rn` | `lib/slmChatService.ts` | Tipada (`LlamaContext`, `require` tipado) desde 20/10 | **Nunca** — o `.gguf` nunca esteve num aparelho |
| `react-native-maps` | `app/mapa.tsx` | Tipada | Sem chave Android, desenha em branco |

**`llama.rn` tinha a forma da quarta ocorrência**: `any` mais `require` sobre a fronteira, sem nunca ter executado. Em 20/10 passou a ser tipado pela tipagem instalada da 0.12.4 (`LlamaContext | null` e `require('llama.rn') as typeof import('llama.rn')`, que mantém o carregamento preguiçoso), e o typecheck agora confere `initLlama`, `completion`, `stopCompletion` e `release`. **Tipado não é executado**: a primeira execução com o `.gguf` continua sendo o teste de verdade. Resta `op-sqlite` como `any` (`nativeDb`), que já executou nove migrações no emulador.

Desde 20/10, os `catch` da fronteira registram o objeto de erro: `loadSlmModel`, `unloadSlmModel`, a inicialização do banco (`db/sqlite.ts`), o boot (`_layout.tsx`) e o GPS da câmera. No do banco, **só o erro, nunca as opções de abertura**, que levam a chave do SQLCipher.

## Armadilhas que já custaram caro

**`any` sobre fronteira nativa — três ocorrências, duas na mesma biblioteca.**
1. `loadModel` em vez de `loadTensorflowModel` (sub-projeto 2)
2. `takePhoto()`, que a `vision-camera` v5 não tem (sub-projeto 3)
3. `TfliteModel.run()` recebe `ArrayBuffer[]`, mas o código passava `Float32Array` (primeira execução, 27/09; corrigido em 06/10)

A terceira é na mesma lib da primeira: consertar o `loadModel` fez o carregamento passar e **só empurrou a falha um passo adiante**, porque se corrigiu a função que aparecia no erro sem auditar o resto da API.

**Teste verde não prova fronteira nativa.** Os 260 testes passavam enquanto a inferência estava quebrada, porque o fake de `loadTensorflowModel` devolvia `Float32Array` — o que o código *esperava*, não o que a biblioteca *entrega*. **Um mock de fronteira nativa só vale o quanto for fiel ao contrato real**: ao escrever um, leia a tipagem instalada e faça o fake obedecê-la. O mesmo vale para o fake de `dbDriver`, que não impõe constraint.

**`catch` genérico engolindo a causa.** Até 09/2026, a inferência chamava uma função inexistente e dependia de um pacote não instalado, e um `catch` escondia os dois. Num catch sobre fronteira nativa, **sempre logar o erro**.

**Barras de navegação falsas.** Existiram na Home e na câmera: três `TouchableOpacity` fazendo `router.push`, com o item ativo escrito à mão, mentindo sobre onde o usuário estava. Foram apagadas no sub-projeto 7. A Home v2 vai construir um `Tabs` de verdade, que é outra coisa.

**Configuração duplicada no `.env`.** Duas linhas `S3_ENDPOINT`, e a segunda vencia: o presigned apontava para dentro do emulador. Custou uma investigação.

**"Código pronto" e "funciona em campo" já divergiram em silêncio por meses, duas vezes.** O app rodou pela primeira vez em **27/09/2026, em emulador**, e dez minutos ali acharam três defeitos que meses de teste verde não acharam.

## Comandos

```bash
# infra + backend — o .env fica na RAIZ (env.ts resolve ../../../.env)
cp .env.example .env              # preencher JWT_SECRET (32+ chars em produção) e LLM_API_KEY
docker compose up -d db minio minio-init
cd backend && npm ci && npm run db:migrate && npm run db:seed && npm run dev
curl http://localhost:3000/api/v1/health

# testes e typecheck — cada pacote no seu diretório; `lint` é alias de typecheck
cd frontend && npm test && npm run typecheck   # 272 / 27, sem dependência externa
cd backend  && npm test && npm run typecheck   # 84 / 13, exige o Postgres do compose no ar
```

O CI (`.github/workflows/ci.yml`) roda lint, typecheck e testes nos dois pacotes, `db:migrate -- --force` e `build` no backend, com Node 22 e Postgres 16.

### App no emulador Android

O app **não roda no Expo Go**: depende de quatro módulos nativos e exige *development build* (`expo run:android`, nunca `expo start` sozinho). O pacote Android é `br.com.cropai`.

```bash
emulator -avd Pixel_7 -gpu host
adb reverse tcp:3000 tcp:3000 && adb reverse tcp:9000 tcp:9000
cd frontend && EXPO_PUBLIC_API_URL=http://localhost:3000 npx expo run:android
```

**Use `adb reverse` com `S3_ENDPOINT=http://localhost:9000`, não `10.0.2.2`.** O backend usa **um único** `S3Client` para duas coisas: assinar o presigned, que o aparelho acessa, e baixar a imagem na segunda opinião, que o próprio backend acessa. `10.0.2.2` só existe de dentro do emulador; do host ele sai pelo roteador. Com `10.0.2.2`, o upload funciona, mas **a segunda opinião não tem como baixar a imagem** e cai em `SKIPPED`; o `.env` local ficou assim até 20/10 (backup em `.env.bak-2026-10-20`). Com `adb reverse`, `localhost` serve aos dois lados. Em aparelho físico pela rede, o IP da LAN também serve aos dois lados.

No emulador a câmera é uma cena 3D falsa: use o **simulador de diagnóstico** (ícone de inseto na câmera, só sob `__DEV__`), que roda o pipeline real sem folha. Sem posição injetada no emulador, o GPS falha, e o diagnóstico é gravado sem posição: não vira pino no mapa.

### Modelo SLM (cópia manual)

O app procura **exatamente** `/data/user/0/br.com.cropai/files/models/gemma-2b-it-q4_k_m.gguf` (`SLM_MODEL_FILENAME`). O comando que `ambiente-local.md` trazia até 20/10 falhava duas vezes: empurrava para `/sdcard/Android/data/...`, que é outro diretório, e mantinha o nome do Hugging Face (`gemma-2-2b-it-...`), que é outro arquivo. O caminho que deve funcionar num build debuggable, **ainda não testado**:

```bash
adb push gemma-2-2b-it-Q4_K_M.gguf /data/local/tmp/
adb shell run-as br.com.cropai mkdir -p files/models
adb shell run-as br.com.cropai cp /data/local/tmp/gemma-2-2b-it-Q4_K_M.gguf files/models/gemma-2b-it-q4_k_m.gguf
```

## Bloqueios conhecidos

| Bloqueio | Efeito |
|---|---|
| **Chave do Google Maps para Android não provisionada** | `/mapa` abre **em branco** no Android; o iOS cai no Apple Maps e funciona. Falha silenciosa: o build passa. Vai em `app.json > android.config.googleMaps.apiKey`, **nunca como placeholder**. Bloqueia a Home v2 |
| **ADR 0001 em aberto**: o `.gguf` não é distribuído | O chat offline não responde. Depende de escolher Gemma 2 2B ou Llama 3.2 3B, o que exige benchmark em hardware alvo, nunca feito |
| **Sem sync manual** | O sub-projeto 7 removeu o único botão. O automático continua, mas **nada re-tenta um item `FAILED`** |
| **Nada provisionado para produção** | Railway, Neon e o bucket S3 real nunca foram criados. Só existem o `Dockerfile` e o CI |

## Dívidas conhecidas

**Achados em 20/10/2026, ao escrever este arquivo.** Quatro foram corrigidos no mesmo dia (spec `especificacoes/2026-10-20-consertos-da-conferencia-design.md`): a limpeza de 30 dias saiu, GPS ausente passou a gravar posição nula, o `S3_ENDPOINT` do emulador virou `localhost` com `adb reverse`, e o `llama.rn` foi tipado. Fica um:

1. **O auto-sync dispara também em `DEGRADED → ONLINE`.** Com latência perto de 1000 ms, a oscilação gera syncs em série (no emulador, dois em 5 s), e cada um varre as segundas opiniões, que são pagas.

**Herdadas das specs e sem dono:**

- A religação de `feedbacksDiagnostico` em `syncDiagnostics` só roda no ramo de insert (desde o sub-projeto 4).
- `doenca_defensivo` não tem `is_active`, então a deleção de relação nunca chega ao aparelho.
- Falha de leitura na Home, em `/catalogo` e em `/mapa` vira só `console.warn`: "a leitura falhou" e "ainda não há dados" ficam iguais para o produtor.
- `montarPinos` faz uma consulta por pino (`resolveDiseaseName` dentro do laço), e não há agrupamento de pinos.
- Não há rollback de migração SQLite: um app antigo com banco novo encontra colunas que não conhece.
- Não há backup nem exportação do banco local. Perder a chave do Keystore torna a fila irrecuperável (ADR 0002).
- O PUT presigned não impõe tamanho no S3 (ADR 0004).
- `rotuloSeveridade` e `tipoSeveridade` (`lib/catalogo.ts`) duplicam a escada de severidade.
- A decisão "sync de conversa só sobe" é de arquitetura e ainda não virou ADR.

## Quando a documentação diverge do código

Em 20/10/2026, a documentação foi conferida contra o código e corrigida: estavam errados a lista de endpoints da `api.md` (`/sync/slm-logs` aposentado, `/sync/conversations` ausente), as tabelas do Postgres no `modelo-de-dados.md`, o gatilho do sync e o botão manual no `offline-first.md`, todos os comandos do `ambiente-local.md`, o dono da chave do banco no ADR 0002, as variáveis mortas no `.env.example` e os caminhos e contagens nos dois READMEs.

A deriva veio sempre do mesmo jeito: um sub-projeto mudou o código e o doc de referência não foi junto. **Mudança de contrato (rota, tabela, variável, comando) leva o doc de referência no mesmo trabalho**, não depois. O código continua sendo a fonte de verdade: na divergência, corrija o doc.

**Esqueletos** (só títulos, porque o conteúdo depende do autor): `produto/visao.md`, `operacao/deploy.md` e `catalogo/curadoria.md`, além do resto de `operacao/homologacao-campo.md`.

## Resíduos que parecem importar e não importam

- O catálogo vive em JSON em `backend/src/db/seeds/` e `frontend/db/seeds/`, que são cópias entre si: **mudar o catálogo exige mudar os dois**. (Uma terceira cópia, morta, em `seed/` na raiz, saiu em 20/10.)
- Há nomes do projeto anterior (*App de Diagnóstico de plantas*): `app.json` com `name`/`slug` `"frontend"` e `scheme` `"app-diagnostico"`, containers `app_diagnostico_*`, bucket `plant-diagnostics`. Renomear qualquer um muda caminho de dado; não é cosmético.
- `git worktree list` mostra um worktree do Antigravity em `~/.gemini/antigravity/worktrees/App de Diagnostico de plantas/frontend-ui-sqlite-auth`. O diretório existe, mas o `.git` dele aponta para o caminho antigo do repositório, então o git não o abre de lá, e o **`git worktree prune` não o limpa**. Em 20/10 ele estava sem alteração local, e a branch `frontend-ui-sqlite-auth` já estava inteira em `origin/main`. Para se livrar dele: `git worktree remove --force "<caminho>"` e `git branch -d frontend-ui-sqlite-auth`. Isso apaga o diretório, então é decisão do dono.

## Referência rápida

**Requisitos** (com estado e desvios em `produto/requisitos.md`; originais em `historico/vault-original/Base do App/Documento de Requisitos do MVP.md`):

| | |
|---|---|
| RF01 | Diagnóstico visual local, com confiança |
| RF02 | Recomendação de defensivo do catálogo local, com aviso legal |
| RF03 | Chat de agronomia híbrido (SLM offline, LLM online) |
| RF04 | Failover de conectividade: *network sensing* e aviso visual do modo |
| RF05 | Store & Forward |
| RF06 | Feedback do produtor sobre o diagnóstico (*human-in-the-loop*) |
| RF07 | Autenticação com refresh rotativo |
| RF08 | Cross-validation visual online |
| RNF01 | Diagnóstico e catálogo 100% disponíveis offline |
| RNF02 | CV com F1 ≥ 85% |
| RNF03 | Persona de agrônomo por prompt de sistema |
| RNF04 | Inferência CV ≤ 500 ms no aparelho alvo |
| RNF05 | SLM ≤ 2 GB de RAM; `.gguf` ≤ 1,5 GB |
| RNF06 | Modelos embarcados no binário — **contradiz o ADR 0001**, reescrever quando ele for decidido |

O mapa não é RF: entrou pela decomposição em sub-projetos, e por isso pôde ser só online.

**As 17 classes de CV** (`frontend/assets/models/labels.txt`): 16 problemas mais `Saudável`. `Fitotoxicidade de Cobre` mapeia para o especial `Fitotoxicidade`. Três rótulos têm nome diferente no catálogo: `Murcha Esclerócio` → Mofo Branco, `Podridão Phytophthora` → Podridão Radicular, `Septoria` → Mancha Parda. **Oito classes têm só 150 imagens de treino** (Antracnose, Crestamento Cercospora, Falso Carvão, Mancha Mirotécio, Mancha Olho de Rã, Mela, Murcha de Esclerócio, Podridão Phytophthora), e a acurácia nelas é provavelmente bem menor. Trocar o `.tflite` sem atualizar `LABELS_LIST`/`LABELS_MAP` faz a inferência lançar erro, de propósito.

**Status de cross-validation:** `PENDING` → `CONFIRMED` (concorda) | `ENRICHED` (concorda e acrescenta) | `DIVERGENT` (**discorda**, e os dois aparecem) | `SKIPPED` (offline, caso especial ou falha).

**"Volta para a Sede":** o risco de dezenas de trabalhadores drenarem as filas ao mesmo tempo no Wi-Fi da sede. A mitigação planejada é o pooler do Neon em modo transaction, mais limites de `/sync/*` generosos.
