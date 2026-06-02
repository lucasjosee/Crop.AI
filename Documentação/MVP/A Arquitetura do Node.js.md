# A Arquitetura do Node.js (Back-end)

Este documento descreve as diretrizes arquiteturais, o ecossistema tecnológico e a estrutura do código-fonte para o desenvolvimento da API no Back-end.

---

## 1. Stack Tecnológica Base

### 1.1 Framework: Fastify
A escolha para o ecossistema de APIs é o **Fastify** em detrimento ao Express tradicional.
- **Desempenho:** Até 5x mais rápido que o Express no processamento de requisições por segundo.
- **Suporte Nativo a Streams:** Essencial para a rota de chat com Server-Sent Events (`POST /api/v1/chat/stream`), gerenciando conexões persistentes de forma muito mais eficiente.
- **Validação de Schema:** Integração nativa com JSON Schema (via AJV), validando o corpo das requisições (como os payloads massivos do *Store and Forward*) antes mesmo de chegarem aos controladores, economizando processamento e memória (CPU).

### 1.2 ORM: Drizzle ORM
Para a comunicação com o PostgreSQL, o **Drizzle ORM** é a ferramenta escolhida.
- **Simetria de Código:** Permite compartilhar as definições de tipos e esquemas diretamente com o front-end (React Native) se necessário, reduzindo duplicação de tipagem.
- **Suporte Nativo a Raw SQL:** Essencial para operações matemáticas complexas com a extensão `pgvector` (operadores `<->` e `<=>`), onde o Prisma frequentemente impõe barreiras de performance e limitações.
- **Abstração Fina:** Diferente do Prisma, o Drizzle não roda um processo binário separado em C++; ele funciona como um gerador de queries TypeScript puro, eliminando qualquer overhead de processamento.

### 1.3 Validação de Schema: Zod
Para a validação estrita de dados de entrada e saída (payloads de API, variáveis de ambiente, etc.), o projeto adota **Zod** como ferramenta única.
- **TypeScript-first:** Os schemas Zod geram automaticamente os tipos TypeScript correspondentes via `z.infer<>`, eliminando duplicação entre tipagem e validação.
- **Integração com Fastify:** Os schemas Zod são convertidos para JSON Schema (compatível com o AJV interno do Fastify) via a biblioteca **`zod-to-json-schema`**, unificando a experiência de desenvolvimento sem abrir mão da performance de validação nativa do Fastify.
- **Reutilização:** O mesmo schema Zod serve para validar a requisição no controlador, tipar os dados no serviço e documentar a API — uma única fonte de verdade.

---

## 2. Estrutura de Pastas (Modular por Camadas)

A arquitetura adota o padrão de separação por responsabilidades (*Separation of Concerns*), facilitando testes unitários, escalabilidade e manutenibilidade da base de código.

```plaintext
src/
├── @types/             # Definições de tipos globais do TypeScript
├── config/             # Variáveis de ambiente, chaves criptográficas e setup de infra
│   ├── env.ts          # Schema Zod das variáveis de ambiente + validação no boot
│   ├── aws.ts          # Configuração do cliente S3 (Presigned URLs)
│   └── llm.ts          # Provider e System Prompt do LLM de nuvem
├── db/                 # Configuração do cliente do Drizzle e arquivos de migração
│   ├── schema/         # Definições das tabelas do PostgreSQL em TypeScript
│   └── index.ts        # Conexão e pooling do banco de dados
├── middlewares/        # Validadores de token, controle de acesso (RBAC) e rate limiters
├── modules/            # Módulos de domínio da aplicação (Cápsulas de Negócio)
│   ├── auth/           # Autenticação (Register, Login, Refresh, Logout)
│   ├── catalog/        # Culturas, Doenças e Defensivos (Delta Sync)
│   ├── chat/           # Chat com LLM de nuvem (SSE Streaming)
│   ├── diagnostics/    # Sincronização de Laudos e Feedbacks (Store & Forward)
│   └── upload/         # Geração de Presigned URLs e validação de imagens (S3)
├── shared/             # Utilitários reutilizáveis entre módulos
│   ├── errors.ts       # Classes de erro padronizadas (AppError, ValidationError)
│   └── logger.ts       # Logger estruturado (JSON) para observabilidade
└── server.ts           # Inicialização do Fastify, registro de plugins e escuta de portas
```

### Anatomia Interna de um Módulo (Exemplo: `modules/auth/`)
Cada módulo isola rigorosamente suas responsabilidades em arquivos específicos:
- `auth.routes.ts`: Declaração dos endpoints HTTP e acoplamento dos schemas de validação.
- `auth.controller.ts`: Interceptação da requisição HTTP, extração de parâmetros de entrada e orquestração da resposta ao cliente.
- `auth.service.ts`: Contém a regra de negócio pura (lógica algorítmica, geração de tokens, chamadas ao banco, criptografia/hashing).
- `auth.schema.ts`: Definição de entrada/saída (Input/Output) usando **Zod** (convertido para JSON Schema via `zod-to-json-schema` para integração nativa com o validador AJV do Fastify).

---

## 3. Estratégia de JWT (Gerenciamento de Tokens)

O sistema de autenticação opera sob o modelo de **Tokens Duplos** (*Access Token* de curta duração + *Refresh Token* de longa duração) para equilibrar segurança de ponta e usabilidade no ambiente mobile rural.

- **Algoritmo de Assinatura:** Utilização obrigatória de **HS256** (Chave Simétrica). Como o back-end Node.js é o único serviço que emitirá e validará os tokens, o HS256 aliado a um segredo de altíssima entropia injetado via variáveis de ambiente garante segurança de ponta e simplifica a implementação frente ao RS256.

### Access Token (JWT)
- **Tempo de vida:** 15 minutos.
- **Payload:** Contém o `sub` (ID do usuário), `role` (nível de permissão ex: `PRODUTOR`) e o escopo de acesso necessário.
- **Tratamento:** Enviado pelo celular no cabeçalho `Authorization: Bearer <token>`. Devido à sua natureza efêmera, *nunca* é armazenado permanentemente no banco de dados.

### Refresh Token (Opaque Token ou JWT de longa vida)
- **Tempo de vida:** 30 dias.
- **Payload/Estrutura:** Pode ser um UUID aleatório de altíssima entropia (*Opaque Token*) ou um JWT associado ao usuário na base de dados.
- **Tratamento:** Este token é **armazenado e validado no banco de dados na nuvem** a cada ciclo de renovação. Isso permite uma segurança reativa vital: possibilita a **revogação remota** imediata da sessão caso o celular do produtor seja roubado ou extraviado.

---

## 4. Fluxo de Autenticação Detalhado

```plaintext
[Aplicativo Móvel]                                   [Servidor Node.js + Postgres]
        |                                                          |
        |---- (A) POST /api/v1/auth/register (Dados Iniciais) ---->| (Cria Usuário com Argon2id)
        |<--- (B) HTTP 201 Created (Confirmação) ------------------|
        |                                                          |
        |---- (C) POST /api/v1/auth/login (Credenciais) ---------->| (Valida Senha e Gera Par de Tokens)
        |<--- (D) HTTP 200 OK { accessToken, refreshToken } -------|
        |                                                          |
    [Uso Normal - 15 minutos se passam - Access Token Expira]      |
        |                                                          |
        |---- (E) POST /api/v1/auth/refresh { refreshToken } ----->| (Valida no Banco e Rotaciona)
        |<--- (F) HTTP 200 OK { accessToken, newRefreshToken } ----|
```

### 4.1 Fluxo de Registro (`POST /api/v1/auth/register`)
- O controlador recebe `nome`, `email` e `password` no corpo da requisição.
- O validador do Fastify rejeita strings vazias ou e-mails fora do padrão internacional.
- O serviço consulta o banco de dados via Drizzle: se o e-mail já existir, aborta com HTTP `409 Conflict`.
- A senha é processada pelo algoritmo **Argon2id**, gerando um hash seguro e resistente a ataques de GPU.
- O Drizzle insere o novo registro na tabela `usuarios` definindo por padrão a coluna `role` como `PRODUTOR`. O banco retorna o ID do usuário.
- O servidor responde com HTTP `201 Created` e os dados básicos do perfil (omitindo o hash da senha).

### 4.2 Fluxo de Login (`POST /api/v1/auth/login`)
- O cliente envia as credenciais de acesso (`email` e `password`).
- O banco busca o registro ativo correspondente ao e-mail. Se não encontrar, retorna HTTP `401 Unauthorized` com mensagem genérica (evitando enumeração de usuários).
- O algoritmo **Argon2id** compara a senha enviada com o hash armazenado. Se houver divergência, retorna HTTP `401`.
- O servidor gera o Access Token (expira em 15 minutos) contendo as permissões do usuário.
- O servidor gera um Refresh Token, armazena o hash desse token no banco de dados atrelado ao `user_id` e define a expiração para 30 dias.
- O payload final é devolvido ao aplicativo com HTTP `200 OK`. O React Native armazena ambos os tokens de forma segura no dispositivo (Keychain no iOS / EncryptedSharedPreferences no Android).

### 4.3 Fluxo de Renovação (`POST /api/v1/auth/refresh`)
Essencial para evitar que o usuário precise digitar a senha a cada 15 minutos. O aplicativo monitora o tempo de expiração ou intercepta erros HTTP `401` para disparar este fluxo automaticamente em background.

- O aplicativo envia o `refreshToken` atual no corpo da requisição.
- O servidor busca o token correspondente na tabela de tokens ativos.
- **Validação de Segurança:**
  - Se o token não existir ou a data atual for maior que a expiração, limpa o registro e retorna HTTP `403 Forbidden` (exigindo novo login com senha).
- **Mecanismo de Rotação (Token Rotation):**
  - Para prevenir ataques de interceptação, o servidor invalida o Refresh Token antigo.
  - Gera um novo Access Token e um novo Refresh Token.
  - Salva o novo Refresh Token no banco de dados.
- O servidor responde com HTTP `200 OK` entregando o novo par de chaves operacionais ao dispositivo móvel.

### 4.4 Fluxo de Logout (`POST /api/v1/auth/logout`)
Crucial para cenários de roubo ou descarte do dispositivo, garantindo o encerramento explícito e imediato da sessão.

- O aplicativo envia uma requisição autenticada (com o Access Token) e o `refreshToken` atual no corpo da requisição.
- O servidor busca e localiza o token exato na tabela `refresh_tokens`.
- **Revogação Explícita:**
  - O registro do token é imediatamente inativado no banco de dados (por exemplo, preenchendo a coluna `revoked_at` com o timestamp atual ou deletando o registro fisicamente).
- O aplicativo descarta os tokens do armazenamento seguro local (Keychain / EncryptedSharedPreferences).
- O servidor responde com HTTP `200 OK`, garantindo que aquele token específico nunca mais gerará um novo ciclo de acesso.

---

## 5. Configuração e Variáveis de Ambiente

O back-end deve validar **todas** as variáveis de ambiente obrigatórias na inicialização do servidor, falhando imediatamente (`process.exit(1)`) se alguma estiver ausente ou inválida. Isso evita erros silenciosos em produção (ex: o servidor subir sem a chave JWT e aceitar requisições sem autenticação).

A validação é feita no arquivo `config/env.ts` usando um schema **Zod** dedicado:

```typescript
// config/env.ts (exemplo conceitual)
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.coerce.number().default(3000),

  // Banco de Dados
  DATABASE_URL: z.string().url(),

  // JWT
  JWT_SECRET: z.string().min(32),

  // AWS S3
  AWS_REGION: z.string(),
  AWS_S3_BUCKET: z.string(),
  AWS_ACCESS_KEY_ID: z.string(),
  AWS_SECRET_ACCESS_KEY: z.string(),

  // LLM Provider
  LLM_PROVIDER: z.enum(['gemini', 'claude']),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL_ID: z.string(),
});

export const env = envSchema.parse(process.env);
```

> [!CAUTION]
> **Segurança:** As variáveis `JWT_SECRET`, `AWS_SECRET_ACCESS_KEY` e `LLM_API_KEY` são segredos de alta sensibilidade. Em produção, devem ser injetadas via gerenciador de segredos (AWS Secrets Manager, Doppler, etc.) e **nunca** commitadas em repositório, `.env` de exemplo, ou logs.

---

## 6. O Módulo de Chat com LLM (`modules/chat/`)

Este módulo é responsável por orquestrar a comunicação entre o app e o LLM de nuvem, atuando como o "Agrônomo Profissional" (RF03). Ele segue a mesma anatomia dos outros módulos (`routes`, `controller`, `service`, `schema`), mas possui particularidades de streaming e construção de prompt que merecem detalhamento.

### 6.1 Escolha do Provider

O provider de LLM é configurável via variável de ambiente `LLM_PROVIDER` (`gemini` ou `claude`). O módulo de chat deve abstrair a comunicação com o provider atrás de uma interface única, permitindo trocar de Gemini para Claude (ou vice-versa) alterando apenas o `.env`, sem modificar código de negócio.

```plaintext
chat.service.ts
    │
    ├── usa interface LLMProvider
    │       │
    │       ├── GeminiProvider (implementa LLMProvider)
    │       └── ClaudeProvider (implementa LLMProvider)
    │
    └── O provider correto é instanciado com base em env.LLM_PROVIDER
```

### 6.2 Construção do Prompt (Context Injection)

No MVP, o LLM de nuvem **não** utiliza RAG vetorial. Em vez disso, o contexto técnico é montado via SQL relacional e injetado diretamente no prompt. O fluxo interno do serviço é:

1. **Receber o request** com `message`, `context` (doença identificada, cultura, confiança) e `history`.
2. **Buscar dados relacionais no PostgreSQL** via Drizzle:
   - Se `context.doenca_identificada` estiver presente, buscar na tabela `doencas` os detalhes (sintomas, severidade, nome científico).
   - Buscar na tabela `doenca_defensivo` → `defensivos` os tratamentos recomendados (nome comercial, ingrediente ativo, dosagem, carência).
3. **Montar o System Prompt** concatenando a persona fixa do Agrônomo com os dados técnicos recuperados:

```plaintext
[System Prompt Fixo]
"Você é um Agrônomo Profissional com especialização em ...
 Sempre descreva o raciocínio clínico (Chain of Thought)...
 Sempre inclua o disclaimer legal..."

[Contexto Injetado Dinamicamente]
"A cultura analisada é Soja.
 A visão computacional identificou: Ferrugem Asiática (Phakopsora pachyrhizi)
 com 92% de confiança. Severidade: 4/5.

 Defensivos indicados no catálogo:
 - Priori Xtra (Azoxistrobina + Ciproconazol) — 300ml/ha — Carência: 30 dias
 - Opera (Piraclostrobina + Epoxiconazol) — 500ml/ha — Carência: 30 dias"

[Histórico da Conversa]
(mensagens anteriores do usuário e do assistente)

[Mensagem Atual do Usuário]
"A ferrugem asiática já está no estágio avançado, qual a dosagem?"
```

4. **Enviar ao LLM** via API do provider com streaming ativado.
5. **Transmitir a resposta** em tempo real via SSE para o front-end.

### 6.3 O System Prompt do Agrônomo

O System Prompt fixo deve ser armazenado em `config/llm.ts` (não hardcoded no serviço), permitindo iteração rápida sem alterar lógica de negócio. Diretrizes obrigatórias do prompt:

- Adotar a persona de um **Agrônomo Profissional** com linguagem acessível ao produtor rural.
- Utilizar raciocínio do tipo **Chain of Thought (CoT)**: descrever o raciocínio clínico antes da conclusão.
- **Nunca** recomendar dosagens inventadas — restringir-se estritamente aos dados do contexto injetado.
- Sempre incluir o **disclaimer legal**: *"Esta recomendação é informativa. A aplicação final deve ser validada por um engenheiro agrônomo com registro no CREA."*
- Responder preferencialmente em **português brasileiro**, adaptando termos técnicos quando necessário.

### 6.4 Gestão de Sessões de Chat

No MVP, o histórico da conversa (`history`) é gerenciado pelo **front-end** e enviado a cada requisição no corpo do request. O back-end é **stateless** em relação ao chat — ele não persiste o histórico das conversas online em banco de dados.

> [!NOTE]
> **Implicação:** Se o app for fechado ou o usuário trocar de tela, o histórico se perde. Essa é uma limitação aceita no MVP para simplificar a implementação. Na **v2**, as sessões de chat online serão persistidas em uma tabela dedicada no PostgreSQL (similar à `sessoes_slm` que já existe para o chat offline), permitindo retomar conversas anteriores.

**Controle de tamanho do histórico:** Para evitar estourar a janela de contexto do LLM (e os custos de API), o front-end deve enviar no máximo as **últimas 20 mensagens** do histórico. Se a conversa for mais longa, as mensagens mais antigas são descartadas (estratégia de *sliding window*).

---


