# Estado Atual do Projeto — App de Diagnóstico de Plantas

**Última atualização:** 05/08/2026  
**Escopo do MVP:** diagnóstico e suporte agronômico exclusivamente para soja  
**Fase atual:** implementação técnica do MVP concluída; entrada em homologação de campo e preparação de distribuição  
**Commit de referência:** `71f6b9e` — `feat: implement visual cross-validation and sprint 7 hardening`

## 1. Resumo executivo

As Sprints 0 a 7 estão majoritariamente implementadas no repositório. O fluxo principal já contempla diagnóstico visual local, catálogo agronômico, chat híbrido, operação offline-first, sincronização Store & Forward, segunda opinião visual online e feedback do produtor.

O projeto ainda não deve ser considerado pronto para publicação nas lojas. A implementação automatizável da Sprint 7 foi concluída, mas faltam homologações em aparelhos reais, integração definitiva da distribuição do modelo GGUF, configuração externa do Railway/GitHub e validações com S3 e providers LLM reais.

Em termos de produto, o projeto está na transição de **MVP implementado** para **Release Candidate de campo**.

## 2. O que está implementado

### Aplicativo mobile

- Expo SDK 56, React Native, TypeScript, Expo Router e Zustand.
- Login, registro, refresh token, logout e recuperação de sessão.
- Tokens armazenados no Expo SecureStore; fallback web permitido somente em desenvolvimento.
- SQLite local com `@op-engineering/op-sqlite`, chave no SecureStore e SQLCipher habilitado.
- Gate de segurança no boot com `isSQLCipher()` e `PRAGMA cipher_version`; builds nativos sem criptografia não usam banco em memória como fallback.
- Migrações incrementais por `PRAGMA user_version`, atualmente até a versão 5.
- Catálogo local de soja, doenças, sintomas, defensivos e relações de tratamento.
- Captura por câmera ou galeria e inferência visual local com TFLite.
- Resultado local exibido imediatamente, inclusive sem internet.
- Tratamento dos resultados especiais Saudável e Fitotoxicidade.
- Navegação do resultado para o chat com contexto do diagnóstico.
- Chat online via SSE e providers Gemini/Claude.
- Chat offline via `llama.rn`, desde que o GGUF já exista no diretório de documentos do app.
- Carregamento JIT do SLM ao abrir o chat em modo campo e liberação do modelo ao sair.
- Cancelamento de resposta, estados de erro, empty state e feedback visual no chat.
- Indicador de conexão ONLINE, DEGRADED e FIELD.
- Sincronização manual e automática na transição FIELD para ONLINE.
- Persistência offline de diagnósticos, feedbacks e logs do SLM.
- Cross-validation online com estados CONFIRMED, ENRICHED, DIVERGENT e SKIPPED.
- Upload da imagem em duas etapas por URL pré-assinada, com reaproveitamento de `image_s3_key`.
- Feedback “correto”, “incorreto” e “parece ser outra doença”, com correção e observações.
- Acessibilidade básica, contraste revisado e labels nas principais ações e navegações.
- Telemetria de startup e cálculo de média/p90 dos tempos de inferência armazenados.

### Backend

- Node.js, Fastify 5, TypeScript, Drizzle ORM e PostgreSQL.
- Autenticação JWT, refresh token rotativo e hashing Argon2.
- Endpoints de autenticação, chat SSE, upload, sincronização e catálogo delta.
- `POST /api/v1/diagnosis/cross-validate` protegido por JWT.
- `user_id` extraído do token e não aceito no payload das operações de diagnóstico/sync.
- Cross-validation com imagem e resultado CV como âncora para o provider LLM.
- Timeout padronizado como 504/`LLM_TIMEOUT` e indisponibilidade como 502/`LLM_UNAVAILABLE`.
- Persistência idempotente da segunda opinião, compatível com diagnóstico ainda pendente de sync.
- Suporte aos providers Gemini e Claude por uma abstração comum.
- Upload para storage compatível com S3/MinIO usando URL pré-assinada.
- Sincronização idempotente de diagnósticos, feedbacks e logs da SLM.
- Logs com redação de Authorization, cookies, senhas e tokens.
- Respostas de erro sem detalhes internos do provider.
- Validação de JWT secret com no mínimo 32 caracteres em produção.
- Container Node 22 multi-stage executado como usuário não-root.
- Script `npm run security:audit-s3` para validar os quatro controles de Public Access Block do bucket.

### Qualidade e automação

- Frontend: 49 testes em 12 arquivos.
- Backend: 46 testes em 11 arquivos.
- Typecheck verde nos dois projetos.
- Export web do Expo concluído com sucesso.
- Build TypeScript e build Docker do backend concluídos com sucesso.
- Testes backend executados em PostgreSQL 16 efêmero e isolado.
- Workflow `.github/workflows/ci.yml` para frontend e backend.
- O job backend do CI cria um PostgreSQL isolado, aplica o schema, executa testes e gera o build.
- Lockfiles compatíveis com o npm 10 usado pela imagem Node 22 e pelo CI.
- Backend sem vulnerabilidades de dependências de produção reportadas por `npm audit --omit=dev`.

## 3. Situação por sprint

| Sprint | Situação | Observação |
|---|---|---|
| 0 — Setup | Concluída | Estrutura frontend/backend e ambiente local disponíveis. |
| 1 — Auth e banco central | Concluída | JWT, Argon2, PostgreSQL, Drizzle e catálogo base. |
| 2 — UI, SQLite e rede | Concluída | Banco local, autenticação mobile e network sensing. |
| 3 — Câmera e CV local | Concluída em código | Performance final ainda precisa ser medida em aparelhos representativos. |
| 4 — Chat híbrido | Concluída em código | Chat offline depende de o GGUF já estar no aparelho. |
| 4.1 — Distribuição do GGUF | Pendente | Download, checksum, retomada e persistência do modelo ainda não foram implementados. |
| 5 — Store & Forward Sync | Concluída | Upload, filas, retry, auto-sync e catálogo delta. |
| 6 — Cross-validation e feedback | Concluída | Backend, frontend, persistência, UX e testes implementados. |
| 7 — Polimento e QA | Parcialmente concluída | Código, segurança, CI e documentação concluídos; homologação externa permanece pendente. |

## 4. O que falta para encerrar o MVP

### 4.1 Distribuição do modelo local

Esta é a principal lacuna funcional antes de entregar o app a produtores sem preparação manual:

- Definir o arquivo GGUF oficial e sua licença de distribuição.
- Definir versão, tamanho e checksum SHA-256 do modelo.
- Implementar download com barra de progresso.
- Permitir retomada após interrupção.
- Validar checksum antes de ativar o modelo.
- Não baixar novamente quando o arquivo íntegro já existir.
- Exibir aviso explícito para download por rede móvel.
- Definir estratégia de atualização e rollback do modelo.

Até isso ser concluído, o chat offline só funciona quando o GGUF é copiado manualmente para `documentDirectory/models/`.

### Homologação em aparelhos

- Executar 30 inferências em dispositivos Android low, mid e high-end.
- Confirmar p90 de inferência menor ou igual a 500 ms no dispositivo mais fraco.
- Medir RAM do SLM e confirmar até 2 GB em operação.
- Confirmar pico combinado CV + SLM até 2,5 GB.
- Medir cold start em pelo menos dez inicializações por perfil.
- Executar o fluxo E2E online em Android e iOS.
- Executar o fluxo E2E offline em modo avião.
- Validar perda de conexão durante upload, timeout LLM e expiração de token durante sync.
- Validar Saudável e Fitotoxicidade em aparelhos reais.
- Completar dez sessões consecutivas sem crash.

### Segurança externa

- Extrair uma cópia autorizada do banco de um aparelho de teste e comprovar que não é legível sem a chave.
- Confirmar tokens e chave do banco no Keychain/Keystore do build release.
- Executar `npm run security:audit-s3` contra o bucket real.
- Revisar logs do Railway, app e providers com tráfego real.
- Fazer rotação e armazenamento definitivo dos segredos nos ambientes de deploy.

### Infraestrutura e deploy

- Publicar o repositório com o workflow e confirmar um run verde no GitHub Actions.
- Proteger a branch `main` e exigir PR + CI verde.
- Conectar `main` ao auto-deploy do Railway.
- Configurar PostgreSQL/Neon de homologação e produção.
- Configurar bucket S3 real com CORS, lifecycle e bloqueio público.
- Configurar credenciais Gemini ou Claude no Railway.
- Executar E2E com MinIO em desenvolvimento e S3 em homologação.
- Configurar monitoramento, alertas e retenção segura de logs.

### Distribuição nas lojas

- Definir identificadores definitivos de Android e iOS.
- Configurar assinatura, EAS Build e perfis de homologação/produção.
- Avaliar Play Asset Delivery para os modelos no Android.
- Avaliar On-Demand Resources no iOS.
- Gerar AAB/APK e archive/IPA release.
- Medir tamanho final e confirmar o limite de 2 GB com modelos.
- Preparar permissões, política de privacidade, descrição e materiais das lojas.

## 5. Limitações e riscos conhecidos

- O GGUF não é distribuído pelo app; o procedimento atual é manual.
- Benchmarks de CV, startup e memória ainda não representam hardware de campo.
- Cross-validation e chat cloud foram testados com providers mockados; a qualidade e latência reais dependem das credenciais e quotas dos providers.
- Upload e auditoria S3 ainda precisam de bucket real; MinIO não cobre todas as políticas da AWS.
- O auto-deploy Railway e a proteção de branch são configurações externas ao repositório.
- O frontend ainda apresenta alertas moderados transitivos do ecossistema Expo/config-plugins. O reparo sugerido pelo npm faria downgrade incompatível para Expo SDK 46 e, por isso, não foi aplicado.
- RAG vetorial, background sync, múltiplas culturas e funcionalidades V2 continuam fora do escopo do MVP.

## 6. Próxima sequência recomendada

1. Concluir a Sprint 4.1 e eliminar a cópia manual do GGUF.
2. Criar builds release de homologação para Android e iOS.
3. Executar a matriz de performance, memória, criptografia e crash-free.
4. Configurar S3, LLM e Railway de homologação e executar E2E completo.
5. Corrigir os problemas encontrados em campo e gerar um novo Release Candidate.
6. Configurar distribuição nas lojas e liberar inicialmente para um grupo fechado de produtores.

## 7. Documentos relacionados

- [[Plano de Implementação (Sprints)]]
- [[Sprint 7 - Homologação de Campo]]
- [[Contratos de API]]
- [[Estratégia de Cross-Validation Visual]]
- [[Infraestrutura e Deploy]]
- [[Arquitetura do App (MVP)]]
