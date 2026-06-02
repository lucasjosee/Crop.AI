# Estratégia de Migração de Banco de Dados (Transição MVP → V2)

A evolução do MVP para a V2 envolve alterações estruturais tanto no banco de dados local (SQLite no React Native) quanto no servidor (PostgreSQL). Como os aplicativos móveis têm ciclos de atualização descentralizados (usuários podem demorar semanas para atualizar o app via Play Store / App Store), a estratégia de migração deve garantir retrocompatibilidade.

---

## 1. Migração no Mobile (SQLite)

O aplicativo React Native utiliza o SQLite nativamente, o que significa que o banco físico (`.db`) mora no armazenamento interno do celular. Quando a V2 for lançada, as novas tabelas e colunas devem ser injetadas de forma incremental e segura.

### Ferramenta de Migração
O ORM local ou a camada de acesso (ex: `drizzle-orm` sobre `op-sqlite` ou bibliotecas como `react-native-quick-sqlite` com scripts raw) deve usar um sistema de controle de versão do schema (`PRAGMA user_version`).

### Alterações Estruturais na V2
1. **Ativação do FTS5:** Para suportar aparelhos legados (Tier 1 do Dynamic Delivery), tabelas de `doencas` e `defensivos` precisarão ter tabelas virtuais associadas usando a extensão nativa FTS5.
2. **Ativação do `sqlite-vec`:** Criação da tabela `documentos_rag` focada em armazenar BLOBs (`float32`).
3. **Novas Colunas de Telemetria:** A `fila_diagnosticos` ganhará:
   - `image_uri_segmented` (TEXT / Opcional)
   - `segmentation_latency_ms` (INTEGER / Opcional)

### Regras de Execução Segura (Mobile)
- As novas colunas na `fila_diagnosticos` **devem** ser criadas como `NULLABLE` (Opcionais) ou ter `DEFAULT`. Isso impede que o banco trave ao ler a fila antiga que o usuário ainda não enviou.
- A migração do banco de dados deve rodar no evento `app-init` ou na tela inicial (Splash Screen). Se a migração falhar (banco corrompido), o app deve tratar o erro, limpar o arquivo corrompido e refazer o download limpo do banco inicial, preservando apenas as filas não sincronizadas.

---

## 2. Migração no Cloud (PostgreSQL / Node.js)

Diferente da web, o back-end mobile precisa lidar ativamente com clientes rodando versões desatualizadas do aplicativo (MVP v1.0 e V2.0 operando simultaneamente).

### Ferramenta de Migração
As migrações na nuvem serão gerenciadas pelo **Drizzle ORM** (`drizzle-kit generate` e `drizzle-kit push`), ativando versionamento restrito.

### Alterações Estruturais na V2
1. **Ativação da Extensão `pgvector`:**
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
2. **Criação da tabela vetorial:** Criação da `documentos_rag` com o tipo `vector(1536)` e índices `HNSW`.
3. **Novas Colunas (Back-end):**
   - Na tabela `diagnosticos`: Adição de `image_uri_segmented` e `segmentation_latency_ms`.
   - Na tabela `sessoes_slm`: Adição do campo de enum `trigger_reason`.

### Retrocompatibilidade dos Contratos de API (Backwards Compatibility)
- **Não quebre o MVP:** Quando o Node.js receber o JSON da fila de diagnósticos do app MVP (que não tem os campos `image_uri_segmented` e `segmentation_latency_ms`), a API **deve** aceitar a requisição com sucesso.
- O validador JSON Schema do Fastify deve colocar os novos campos como não obrigatórios (`required: false`).
- A lógica de serviço deve tratar graciosamente a ausência desses dados, inferindo que o tráfego pertence à versão anterior do app.

---

