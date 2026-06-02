# A Arquitetura do PostgreSQL (Back-end)

Este documento define a estrutura do banco de dados principal do sistema, hospedado na nuvem. O PostgreSQL atua como a **Fonte da Verdade (Source of Truth)**, armazenando dados globais do catálogo, embeddings para buscas robustas e recebendo toda a telemetria e diagnósticos sincronizados pelos celulares (padrão Store and Forward).

---

## 1. Usuários e Autenticação

- **`usuarios`**
  - `id` (UUID, PK)
  - `email` (String, Único)
  - `nome` (String)
  - `password_hash` (String)
  - `role` (Enum: `ADMIN`, `PRODUTOR`)
  - `created_at` (Timestamp)
  - `updated_at` (Timestamp)
  - `deleted_at` (Timestamp, Opcional) — *Usado para padronização de Soft Delete em vez de exclusão física.*

- **`refresh_tokens`**
  - `id` (UUID, PK)
  - `user_id` (FK para `usuarios.id`)
  - `token_hash` (String, Único) — *Hash seguro do opaque token enviado ao dispositivo*
  - `device_info` (String, Opcional) — *Armazena qual celular solicitou o token (ex: "iPhone 15 Pro")*
  - `expires_at` (Timestamp)
  - `revoked_at` (Timestamp, Opcional) — *Se preenchido, o token é invalidado imediatamente*
  - `created_at` (Timestamp)

---

## 2. Tabelas de Domínio (Catálogo Central)
Diferente do SQLite (que foca em performance de leitura), o PostgreSQL precisa focar em **rastreabilidade e sincronização**. Por isso, todas as tabelas possuem `updated_at`, que é a chave do mecanismo de *Delta Sync* (enviar para o mobile apenas o que mudou).

- **`culturas`**
  - `id` (UUID, PK)
  - `nome` (String)
  - `estagio_fenologico_padrao` (JSONB)
  - `is_active` (Boolean)
  - `updated_at` (Timestamp)

- **`doencas`**
  - `id` (UUID, PK)
  - `id_cultura` (FK para `culturas.id`)
  - `nome_comum` (String)
  - `nome_cientifico` (String)
  - `sintomas` (Text) — *Descrição dos sintomas visíveis e estágios de desenvolvimento da patologia. Sincronizado para o SQLite via Delta Sync e injetado como contexto no prompt do LLM/SLM.*
  - `nivel_severidade` (Inteiro: 1 a 5)
  - `is_active` (Boolean)
  - `updated_at` (Timestamp)

- **`defensivos`**
  - `id` (UUID, PK)
  - `nome_comercial` (String)
  - `ingrediente_ativo` (String)
  - `classe` (String)
  - `bula_resumida` (Text) — *Resumo das diretrizes de aplicação, segurança e modo de uso extraído da bula oficial. Exibido na tela de recomendação (RF02) e injetado como contexto no prompt do LLM/SLM.*
  - `is_active` (Boolean)
  - `updated_at` (Timestamp)

- **`doenca_defensivo`** (Tabela de Ligação)
  - `id` (UUID, PK)
  - `id_doenca` (FK)
  - `id_defensivo` (FK)
  - `dosagem_recomendada` (Texto)
  - `carencia_dias` (Inteiro)
  - `updated_at` (Timestamp)

> [!CAUTION]
> **Divergência de Chave Primária (Atenção na API):** 
> Note que aqui no PostgreSQL a tabela `doenca_defensivo` tem seu próprio `id` UUID. Porém, no SQLite do celular, ela usa uma Chave Primária Composta (`id_doenca` + `id_defensivo`). Ao montar o JSON de sincronização no Node.js (Endpoint 5.1), lembre-se de omitir este campo `id` do Postgres para não quebrar a estrutura estrita esperada pelo React Native.

---

## 3. A Tabela Vetorial (pgvector) [Escopo v2]

> [!NOTE]
> **Escopo MVP vs v2:** O uso de bancos vetoriais (tanto offline no celular quanto na nuvem via `pgvector`) foi adiado para a **v2**. No MVP, o chat na nuvem vai operar consumindo metadados relacionais clássicos (Nome da Doença, Sintomas e Defensivos) diretamente da tabela via SQL tradicional para fornecer contexto ao LLM. As definições abaixo e as recomendações de índices HNSW/IVFFlat aplicam-se apenas à evolução do banco (v2).

Guarda todos os pedaços (chunks) de bulas e guias agronômicos. Utiliza a extensão nativa **`pgvector`** do PostgreSQL.

- **`documentos_rag`**
  - `id` (UUID, PK)
  - `tipo_entidade` (Enum: `DOENCA`, `DEFENSIVO`)
  - `id_entidade` (UUID) — *Armadilha Polimórfica (Ver nota na seção de Segurança)*
  - `conteudo_texto` (Text)
  - `vetor` (Tipo `vector(1536)` - ou dependente do modelo de embedding usado)
  - `is_active` (Boolean)
  - `updated_at` (Timestamp)

> [!TIP]
> **Índices de Performance:** É fundamental criar um índice HNSW (Hierarchical Navigable Small World) ou IVFFlat na coluna `vetor` do `pgvector` para que a busca semântica em nuvem (quando o Agrônomo LLM for chamado) seja na casa dos milissegundos.

---

## 4. Dados Sincronizados (Store and Forward)
Essas tabelas recebem a carga de dados que os celulares enviam quando a internet é restabelecida.

- **`diagnosticos`**
  - `id` (UUID, PK) — *Este é o `server_id` devolvido para o app celular*
  - `user_id` (FK para `usuarios.id`)
  - `mobile_local_id` (UUID, Único) — *O ID original gerado offline no celular. Constraint UNIQUE para evitar duplicatas no Store & Forward.*
  - `image_s3_key` (String) — *Chave (path) do arquivo no bucket S3. O acesso é controlado exclusivamente via Signed URLs com expiração curta (15 min), nunca por URLs públicas.*
  - `latitude` (Float)
  - `longitude` (Float)
  - `doenca_id` (FK para `doencas.id`) — *A suspeita primária da Visão Computacional*
  - `confianca_ia` (Float)
  - `modelo_usado` (String) — *Identifica o runtime e versão do modelo que gerou o diagnóstico (ex: `coreml_v1.0`, `tflite_v1.0`). Essencial para rastreabilidade de performance por versão do modelo.*
  - `tempo_inferencia_ms` (Inteiro) — *Latência da inferência local em milissegundos. Métrica de telemetria para detectar degradação por hardware ou thermal throttling.*
  - `llm_doenca_id` (FK opcional para `doencas.id`) — *Resultado da cross-validation do LLM Multimodal (RF08). Nulo quando o diagnóstico foi feito offline ou quando o LLM concorda com o CV (nesse caso, `cross_validation_status` = `CONFIRMED`).*
  - `llm_confianca` (Float, Opcional) — *Nível de confiança subjetivo do LLM na sua análise. Nulo se offline.*
  - `llm_observacoes` (Text, Opcional) — *Observações adicionais do LLM (ex: deficiência nutricional, saúde geral). Exibidas na tela de diagnóstico como "Observações do Agrônomo IA".*
  - `cross_validation_status` (Enum: `PENDING`, `CONFIRMED`, `ENRICHED`, `DIVERGENT`, `SKIPPED`) — *Status do cruzamento CV × LLM. `SKIPPED` quando offline, `PENDING` enquanto aguarda resposta do LLM.*
  - `captured_at` (Timestamp) — *Momento em que a foto foi tirada offline*
  - `synced_at` (Timestamp) — *Momento em que o dado chegou ao servidor*

- **`feedbacks_diagnostico`**
  - `id` (UUID, PK)
  - `user_id` (FK para `usuarios.id`)
  - `diagnostico_id` (FK opcional para `diagnosticos.id`)
  - `mobile_local_id` (UUID) — *Usado como fallback caso chegue antes do diagnóstico na fila*
  - `status` (Enum: `PENDING_DIAGNOSTIC`, `PROCESSED`)
  - `is_correct` (Boolean)
  - `corrected_doenca_id` (FK opcional para `doencas.id`)
  - `user_correction_notes` (Text)
  - `feedback_at` (Timestamp)
  - `synced_at` (Timestamp)

- **`sessoes_slm`** (Histórico de Chat Offline)
  - `id` (UUID, PK)
  - `user_id` (FK para `usuarios.id`)
  - `mobile_session_id` (UUID original do celular)
  - `model_version` (String, ex: `gemma_2b_q4`)
  - `started_at` (Timestamp)
  - `ended_at` (Timestamp)
  - `synced_at` (Timestamp)

- **`interacoes_slm`** (As mensagens de cada sessão)
  - `id` (UUID, PK)
  - `sessao_id` (FK para `sessoes_slm.id`)
  - `prompt` (Text)
  - `response` (Text)
  - `latency_ms` (Inteiro)
  - `rag_used_documents` (JSONB) — *Sempre vazio no MVP (pois o RAG vetorial foi adiado para a v2). Reservado para auditoria futura.*
  - `created_at` (Timestamp)

> [!NOTE]
> **Sessões de Chat em Nuvem (Escopo v2):** No MVP, o histórico de conversas com o LLM de nuvem (`POST /api/v1/chat/stream`) é gerenciado pelo front-end de forma stateless — o back-end não persiste essas sessões. Na **v2**, será criada uma tabela dedicada (similar a `sessoes_slm` + `interacoes_slm`) para permitir que o usuário retome conversas anteriores e para auditoria do System Prompt.

### 4.1 Índices Relacionais Obrigatórios (MVP)

Para garantir performance nas queries mais frequentes (filtros por usuário, lookups de sincronização e joins do catálogo), os seguintes índices devem ser criados junto com as tabelas:

```sql
-- Autenticação: busca de tokens ativos por usuário
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);

-- Diagnósticos: filtro por usuário (isolamento de dados no serviço)
CREATE INDEX idx_diagnosticos_user_id ON diagnosticos(user_id);

-- Diagnósticos: prevenção de duplicatas no Store & Forward
CREATE UNIQUE INDEX idx_diagnosticos_mobile_local_id ON diagnosticos(mobile_local_id);

-- Feedbacks: lookup por diagnóstico associado
CREATE INDEX idx_feedbacks_diagnostico_id ON feedbacks_diagnostico(diagnostico_id);

-- Feedbacks: fallback por local_id quando o diagnóstico ainda não chegou
CREATE INDEX idx_feedbacks_mobile_local_id ON feedbacks_diagnostico(mobile_local_id);

-- Catálogo: constraint de unicidade na tabela de ligação
CREATE UNIQUE INDEX idx_doenca_defensivo_unique ON doenca_defensivo(id_doenca, id_defensivo);

-- Sessões SLM: filtro por usuário
CREATE INDEX idx_sessoes_slm_user_id ON sessoes_slm(user_id);

-- Interações SLM: lookup por sessão
CREATE INDEX idx_interacoes_slm_sessao_id ON interacoes_slm(sessao_id);

-- Delta Sync: busca de registros alterados desde a última sincronização
CREATE INDEX idx_doencas_updated_at ON doencas(updated_at);
CREATE INDEX idx_defensivos_updated_at ON defensivos(updated_at);
CREATE INDEX idx_culturas_updated_at ON culturas(updated_at);
```

---

## 5. Segurança e Infraestrutura de Banco

Para garantir a proteção dos dados (LGPD) e a estabilidade da aplicação em cenários rurais extremos, a implementação deste banco deve obrigatoriamente seguir as diretrizes abaixo:

### 5.1 Criptografia e Autenticação
- **Algoritmo de Hash Seguro:** A coluna `password_hash` da tabela `usuarios` **nunca** deve armazenar senhas utilizando os descontinuados MD5 ou SHA1. A implementação do Node.js deve gerar os hashes utilizando **Argon2** (preferencialmente) ou **bcrypt** com fator de custo devidamente atualizado.
- **Controle de Acesso (Roles):**
  - `PRODUTOR`: Tem acesso de leitura restrito às tabelas de Catálogo, e permissão estrita e exclusiva aos seus próprios diagnósticos e histórico de chat.
  - `ADMIN`: Tem acesso completo ao painel gerencial, podendo criar e modificar doenças e defensivos, além de analisar os dados e telemetria agregada e anonimizada.

### 5.2 Privacidade de Dados e Isolamento (LGPD)
- **Isolamento de Inquilino via RLS (Row-Level Security) [Escopo v2]:** Todas as tabelas que contêm dados do usuário (como `diagnosticos`, `feedbacks_diagnostico`, e histórico SLM) deverão ter políticas nativas de *RLS* ativadas no PostgreSQL na **v2**. Para o MVP, o isolamento será garantido programaticamente na camada de serviço do Node.js para agilizar o lançamento. O RLS blindará a aplicação no futuro caso haja uma falha no back-end.
- **Geolocalização como Dado Sensível:** Os campos `latitude` e `longitude` são protegidos pela LGPD pois revelam a exata localização da propriedade e rotina do trabalhador. Precisam de tratamento sensível.
- **Imagens em S3 via Signed URLs:** O campo `image_s3_key` armazena apenas a chave (path) do arquivo no bucket S3. A API do Node.js **nunca** deve expor a foto da lavoura em uma URL pública (isso exporia o ativo do produtor indefinidamente). Quando o app solicitar a visualização da imagem, o Node.js gera e retorna uma **Signed URL (URL Assinada)** com expiração curta (ex: 15 minutos).

### 5.3 O Efeito "Volta para a Sede" (Esgotamento de Conexões)
Ao final do dia, existe o evento conhecido como *Volta para a Sede*: dezenas de trabalhadores do campo retornarão simultaneamente, conectarão seus celulares ao Wi-Fi e ativarão o *Store and Forward*. O app despachará rajadas massivas de fotos e diagnósticos atrasados.
- **Risco:** O motor do PostgreSQL possui um limite nativo baixo para gerenciar conexões simultâneas concorrentes (geralmente estourando em ~100 conexões na sua configuração padrão).
- **Ação:** O back-end Node.js ou a infraestrutura do banco devem implementar um **Connection Pooler** robusto (como o **PgBouncer**, Prisma Accelerate ou Pgpool-II). O *Pooler* enfileirará as requisições, barrando que o banco recuse conexões (Crash) e distribuindo os inserts organizadamente.

### 5.4 SQL Injection em Raw SQL

> [!IMPORTANT]
> **Aplica-se ao MVP e à v2.** Embora o RAG vetorial (`pgvector`) seja escopo da v2, o risco de SQL Injection existe em **qualquer** Raw SQL — incluindo queries de catálogo e contexto relacional usadas no MVP.

ORMs como o Drizzle frequentemente exigem que o programador escreva consultas com **SQL Puro (Raw SQL)** para operações complexas.
- **Risco:** Se o input da pergunta do usuário (ex: o *prompt* do chat) for diretamente interpolado dentro dessa Raw Query via variáveis literais, ocorre o cenário perfeito para **SQL Injection**, permitindo a deleção em massa do banco.
- **Ação:** Nunca concatene strings livremente ao usar SQL Cru. Certifique-se de passar os textos através de **Prepared Statements (Consultas Parametrizadas)** do Drizzle (`sql.placeholder()` ou template literals `sql\`...\``), neutralizando inteiramente as injeções maliciosas.

### 5.5 Armadilha Polimórfica (Integridade Relacional) [Escopo v2]

> [!NOTE]
> Esta seção refere-se exclusivamente à tabela `documentos_rag` (seção 3), que é **escopo da v2**. Está documentada aqui como referência antecipada para a migração.

Como pontuado na seção 3, a coluna `id_entidade` de `documentos_rag` atua como chave estrangeira polimórfica (apontando dinamicamente para tabelas de Doenças ou Defensivos).
- **Ação:** Bancos de dados relacionais não permitem `ON DELETE CASCADE` de múltiplos alvos num mesmo campo. Para não se deparar com vetores pesados "órfãos" pesando no banco, crie uma **Check Constraint/Trigger** no Postgres para limpar o registro vetor sempre que o seu elemento pai for inativado/deletado, ou garanta essa regra lógica programaticamente no ORM do Node.js.

---


