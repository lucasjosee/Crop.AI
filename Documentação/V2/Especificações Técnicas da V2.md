# Especificações Técnicas - Escopo V2 (Evolução do Produto)

Este documento consolida todas as arquiteturas, tabelas e processos complexos que foram extraídos do escopo do MVP para garantir um lançamento rápido. Estas funcionalidades devem ser implementadas exclusivamente na fase 2 (V2) do aplicativo.

---

## 1. RAG Vetorial Offline (Edge AI Avançado)

Na V2, a SLM local (`llama.rn`) deixará de usar o fallback relacional simples e passará a usar um motor real de RAG (*Retrieval-Augmented Generation*) diretamente no dispositivo, economizando tokens e fornecendo precisão cirúrgica sem internet.

**1.1 O Motor Vetorial (SQLite):**
Será instalada e configurada a extensão **`sqlite-vec`** em conjunto com o `op-sqlite`.

**1.2 A Tabela Vetorial no App:**
- **`documentos_rag`**
    - `id` (PK)
    - `tipo_entidade` (Enum: "DOENCA" ou "DEFENSIVO")
    - `id_entidade` (FK para `doencas.id` ou `defensivos.id`)
    - `conteudo_texto` (O parágrafo exato extraído do PDF/Bula)
    - `vetor` (BLOB - Array de floats gerado pelo modelo de embedding)

**1.3 O Fluxo da Query na V2:**
1. **A Busca Semântica:** O SQLite roda uma query vetorial comparando o embedding da pergunta com a coluna `vetor` da tabela `documentos_rag`.
2. **O Join Relacional:** A query retorna os trechos de `conteudo_texto` mais similares e usa o `id_entidade` para puxar os metadados rápidos (nome técnico, carência).
3. **O Prompt:** O app injeta o contexto semântico mastigado e aciona a SLM local para formular a resposta.

---

## 2. RAG Vetorial em Nuvem (PostgreSQL pgvector)

Na V2, o LLM de nuvem (Gemini/Claude) também passará a realizar busca semântica em todo o banco de conhecimentos, indo além das simples tabelas relacionais do MVP.

**2.1 O Motor Vetorial (Cloud):**
Ativação e uso intensivo da extensão **`pgvector`** no PostgreSQL.

**2.2 A Tabela Vetorial no Back-end:**
- **`documentos_rag`**
  - `id` (UUID, PK)
  - `tipo_entidade` (Enum: `DOENCA`, `DEFENSIVO`)
  - `id_entidade` (UUID) — *Atenção à Armadilha Polimórfica: Gerenciar deleção via Node.js ou Check Constraints*
  - `conteudo_texto` (Text)
  - `vetor` (Tipo `vector(1536)` dependente do modelo)
  - `is_active` (Boolean)
  - `updated_at` (Timestamp)

> **Índices Requeridos:** É imperativo criar um índice `HNSW` ou `IVFFlat` na coluna `vetor` para escalar as buscas sem gargalos no PostgreSQL.

**2.3 Endpoint de Sincronização de Chunks (API):**
Para que o `sqlite-vec` do celular tenha os mesmos vetores da nuvem, a V2 inclui o seguinte endpoint para trafegar esses dados pesados em background.

`GET /api/v1/catalog/vectors/sync`
- **Query Params:** `cursor` (para paginação) e `limit` (max 50, devido ao tamanho do BLOB).
- **Response:** Um delta contendo os novos vetores (arrays float) e os identificadores.

---

## 3. Sincronização Invisível (Background Fetch)

Na V2, o produtor não precisará mais clicar em um botão "Sincronizar" manualmente (Store and Forward manual do MVP).
- O aplicativo integrará o módulo de **Background Fetch** nativo do iOS e Android.
- Assim que o Sistema Operacional detectar *Wi-Fi Unmetered* e bateria acima de 30%, ele acordará a *Headless Task* do React Native em segundo plano.
- A rotina despachará a fila de diagnósticos (`fila_diagnosticos` e `fila_feedbacks`) silenciosamente e atualizará os catálogos relacionais e vetoriais, otimizando a experiência do usuário.

---

## 4. Segurança e Métricas Avançadas

Para suportar o volume do produto final com multi-inquilinos na nuvem, a V2 endurecerá os controles:

**4.1 Row-Level Security (RLS)**
A camada de isolamento do inquilino sairá do código Node.js (ORM) e será aplicada fisicamente nas tabelas do PostgreSQL via **Políticas de RLS**. 
- Um usuário logado só terá permissão física do banco para executar `SELECT` ou `INSERT` em registros onde `user_id == current_user()`.
- Isso previne categoricamente falhas humanas em rotas futuras.

**4.2 Métrica de Telemetria (Failover)**
A tabela `sessoes_slm` do PostgreSQL voltará a ter o campo `trigger_reason` (`NO_INTERNET`, `HIGH_LATENCY`, `SERVER_ERROR`). Essa métrica permitirá construir dashboards gerenciais no painel do administrador para descobrir em quais regiões o modelo está recorrendo ao Edge AI por problemas da rede de operadoras.

---


