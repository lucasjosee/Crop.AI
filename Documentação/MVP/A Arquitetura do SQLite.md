# A Arquitetura do SQLite (Mobile)

Este documento define a estrutura do banco de dados local do aplicativo, armazenado no dispositivo do produtor via **`op-sqlite`** (acesso JSI na velocidade nativa). O SQLite atua como o **banco offline-first**, garantindo que diagnósticos, catálogo e filas de sincronização estejam sempre disponíveis sem internet.

---

## 1. Tabelas de Domínio (Dados Estruturados)

Essas tabelas guardam as informações exatas e curtas para exibir na tela (o Catálogo e o Guia que você definiu no RF01). São populadas via Delta Sync a partir do PostgreSQL (`GET /api/v1/catalog/sync`).

![[Pasted image 20260522031243.png]]

- **`culturas`**
    - `id` (TEXT, PK)
    - `nome` (TEXT — ex: Soja, Milho)
    - `estagio_fenologico_padrao` (TEXT/JSON)

- **`doencas`**
    - `id` (TEXT, PK)
    - `id_cultura` (TEXT, FK para `culturas.id`)
    - `nome_comum` (TEXT — ex: Ferrugem Asiática)
    - `nome_cientifico` (TEXT — ex: _Phakopsora pachyrhizi_)
    - `sintomas` (TEXT — Descrição dos sintomas visíveis e estágios de desenvolvimento da patologia. Usado para exibição na tela de diagnóstico e como contexto textual injetado no prompt da SLM local.)
    - `nivel_severidade` (INTEGER — 1 a 5)

- **`defensivos`**
    - `id` (TEXT, PK)
    - `nome_comercial` (TEXT — ex: Priori Xtra)
    - `ingrediente_ativo` (TEXT — ex: Azoxistrobina + Ciproconazol)
    - `classe` (TEXT — ex: Fungicida)
    - `bula_resumida` (TEXT — Resumo das diretrizes de aplicação, segurança e modo de uso extraído da bula oficial. Exibido na tela de recomendação de tratamento (RF02) e injetado como contexto no prompt da SLM.)

- **`doenca_defensivo`** (Tabela de Ligação)
    - `id_doenca` (TEXT, FK — parte da PK composta)
    - `id_defensivo` (TEXT, FK — parte da PK composta)
    - `dosagem_recomendada` (TEXT — ex: "300ml/ha")
    - `carencia_dias` (INTEGER)

> [!CAUTION]
> **Divergência de Chave Primária com o PostgreSQL:** No PostgreSQL, a tabela `doenca_defensivo` possui seu próprio `id` UUID. Aqui no SQLite, ela usa uma **Chave Primária Composta** (`id_doenca` + `id_defensivo`). O endpoint de Delta Sync (`GET /api/v1/catalog/sync`) deve omitir o `id` do Postgres no payload para não quebrar a estrutura do mobile.

### DDL — Tabelas de Domínio

```sql
CREATE TABLE IF NOT EXISTS culturas (
    id              TEXT PRIMARY KEY,
    nome            TEXT NOT NULL,
    estagio_fenologico_padrao TEXT -- JSON armazenado como texto
);

CREATE TABLE IF NOT EXISTS doencas (
    id                  TEXT PRIMARY KEY,
    id_cultura          TEXT NOT NULL REFERENCES culturas(id),
    nome_comum          TEXT NOT NULL,
    nome_cientifico     TEXT,
    sintomas            TEXT, -- Descrição textual dos sintomas e estágios
    nivel_severidade    INTEGER CHECK (nivel_severidade BETWEEN 1 AND 5)
);

CREATE TABLE IF NOT EXISTS defensivos (
    id                  TEXT PRIMARY KEY,
    nome_comercial      TEXT NOT NULL,
    ingrediente_ativo   TEXT NOT NULL,
    classe              TEXT NOT NULL,
    bula_resumida       TEXT -- Diretrizes de aplicação e segurança
);

CREATE TABLE IF NOT EXISTS doenca_defensivo (
    id_doenca           TEXT NOT NULL REFERENCES doencas(id),
    id_defensivo        TEXT NOT NULL REFERENCES defensivos(id),
    dosagem_recomendada TEXT NOT NULL,
    carencia_dias       INTEGER NOT NULL,
    PRIMARY KEY (id_doenca, id_defensivo)
);
```

---

## 2. A Fila de Sincronização (Store and Forward)

Como o app opera nativamente no padrão _offline-first_ (RF05), qualquer dado transacional criado pelo usuário (como uma foto ou correção) no meio do campo é salvo primeiro nestas tabelas locais. A sincronização com a nuvem ocorrerá via **Ação Manual** (um botão na interface principal alertando "Você tem X diagnósticos para sincronizar").

- **`fila_diagnosticos`** (Para alimentar a rota `POST /api/v1/sync/diagnostics`)
    - `local_id` (TEXT, PK — UUID gerado no próprio celular)
    - `server_id` (TEXT — UUID nulo por padrão. Preenchido apenas quando a API retornar sucesso)
    - `image_uri` (TEXT — Caminho local apontando para o diretório persistente do app)
    - `image_s3_key` (TEXT — Chave no S3 após upload via Presigned URL. Nulo até o upload ser concluído)
    - `latitude` (REAL — Coordenada no momento da captura)
    - `longitude` (REAL — Coordenada no momento da captura)
    - `doenca_id` (TEXT, FK para `doencas.id` — a suspeita da IA de visão)
    - `confianca_ia` (REAL — ex: 0.88)
    - `modelo_usado` (TEXT — ex: "coreml_v1.2" ou "tflite_v1.0")
    - `tempo_inferencia_ms` (INTEGER — latência da inferência local em milissegundos)
    - `timestamp` (TEXT/DateTime)
    - `sync_status` (TEXT — `PENDING`, `SYNCING`, `SYNCED` ou `FAILED`)
    - `retry_count` (INTEGER, Default: 0)

- **`fila_feedbacks`** (Para alimentar a rota `POST /api/v1/sync/feedback`)
    - `id` (TEXT, PK — UUID)
    - `diagnostic_local_id` (TEXT, FK apontando para `fila_diagnosticos.local_id`)
    - `is_correct` (INTEGER — 0 ou 1, simulando booleano)
    - `corrected_doenca_id` (TEXT, FK opcional apontando para `doencas.id`)
    - `user_correction_notes` (TEXT)
    - `timestamp` (TEXT/DateTime)
    - `sync_status` (TEXT — `PENDING`, `SYNCING`, `SYNCED` ou `FAILED`)
    - `retry_count` (INTEGER, Default: 0)

- **`fila_slm_logs`** (Para auditar as conversas do LLM local — coleta de dados para Fine-Tuning na v2)
    - `session_id` (TEXT, PK — UUID)
    - `started_at` (TEXT/DateTime)
    - `model_version` (TEXT — versão do arquivo `.gguf`, ex: "gemma_2b_q4")
    - `interactions_json` (TEXT/JSON — contém o prompt do produtor, a resposta do modelo e o tempo de inferência local)
    - `sync_status` (TEXT — `PENDING`, `SYNCING`, `SYNCED` ou `FAILED`)
    - `retry_count` (INTEGER, Default: 0)

### DDL — Filas de Sincronização

```sql
CREATE TABLE IF NOT EXISTS fila_diagnosticos (
    local_id            TEXT PRIMARY KEY,
    server_id           TEXT,
    image_uri           TEXT NOT NULL,
    image_s3_key        TEXT, -- Preenchido após upload via Presigned URL
    latitude            REAL,
    longitude           REAL,
    doenca_id           TEXT REFERENCES doencas(id),
    confianca_ia        REAL,
    modelo_usado        TEXT NOT NULL,
    tempo_inferencia_ms INTEGER,
    timestamp           TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status         TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (sync_status IN ('PENDING', 'SYNCING', 'SYNCED', 'FAILED')),
    retry_count         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fila_feedbacks (
    id                      TEXT PRIMARY KEY,
    diagnostic_local_id     TEXT NOT NULL REFERENCES fila_diagnosticos(local_id),
    is_correct              INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
    corrected_doenca_id     TEXT REFERENCES doencas(id),
    user_correction_notes   TEXT,
    timestamp               TEXT NOT NULL DEFAULT (datetime('now')),
    sync_status             TEXT NOT NULL DEFAULT 'PENDING'
                            CHECK (sync_status IN ('PENDING', 'SYNCING', 'SYNCED', 'FAILED')),
    retry_count             INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fila_slm_logs (
    session_id      TEXT PRIMARY KEY,
    started_at      TEXT NOT NULL,
    model_version   TEXT NOT NULL,
    interactions_json TEXT NOT NULL, -- JSON array com prompts, respostas e latências
    sync_status     TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (sync_status IN ('PENDING', 'SYNCING', 'SYNCED', 'FAILED')),
    retry_count     INTEGER NOT NULL DEFAULT 0
);
```

---

## 3. Segurança do Banco Local

### 3.1 Criptografia em Repouso

O arquivo `.db` do SQLite é desprotegido por padrão. Caso o dispositivo seja roubado ou acessado indevidamente, todos os dados ficam expostos. Utilizar **SQLCipher** para criptografar o banco completo em repouso.

> [!WARNING]
> **Compatibilidade com `op-sqlite`:** O `op-sqlite` suporta SQLCipher nativamente desde a versão 4.x, mas requer a flag `useSQLCipher: true` na configuração do plugin e a distribuição do binário com a extensão incluída. Isso aumenta o tamanho do bundle nativo em aproximadamente ~2MB. Verificar a documentação oficial do `op-sqlite` para confirmar a versão mínima compatível antes da implementação.

### 3.2 Armazenamento de Imagens

O campo `image_uri` da `fila_diagnosticos` deve apontar para o **diretório persistente do app** (ex: `Documents/` no iOS ou `files/` no Android), nunca para o cache do sistema. O SO pode limpar o cache a qualquer momento, corrompendo diagnósticos pendentes de sincronização.

### 3.3 Dados Sensíveis em `interactions_json`

Conversas com a SLM podem conter informações sensíveis do produtor. Avaliar o que é realmente necessário persistir antes de salvar a sessão completa, descartando prompts intermediários que não agregam valor ao fine-tuning.

### 3.4 Política de Limpeza

Registros com `sync_status = SYNCED` devem ser removidos periodicamente para evitar acúmulo indefinido. Recomendado deletar registros sincronizados após **30 dias**, mantendo o banco leve e reduzindo a superfície de exposição de dados.

```sql
-- Rotina de limpeza (executar periodicamente no app-init ou em background)
DELETE FROM fila_diagnosticos
WHERE sync_status = 'SYNCED'
  AND timestamp < datetime('now', '-30 days');

DELETE FROM fila_feedbacks
WHERE sync_status = 'SYNCED'
  AND timestamp < datetime('now', '-30 days');

DELETE FROM fila_slm_logs
WHERE sync_status = 'SYNCED'
  AND started_at < datetime('now', '-30 days');
```
---

