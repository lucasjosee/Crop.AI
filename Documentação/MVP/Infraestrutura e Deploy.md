# Infraestrutura e Deploy (MVP)

Este documento define a stack de infraestrutura em nuvem para o MVP do App de Diagnóstico. A estratégia prioriza **velocidade de entrega e simplicidade operacional** sobre escalabilidade massiva, permitindo que um time pequeno (1-2 devs) valide o produto sem overhead de DevOps.

---

## 1. Stack de Infraestrutura

```mermaid
graph LR
    subgraph "Dispositivo do Produtor"
        APP["📱 React Native App"]
    end

    subgraph "Railway (Backend)"
        FASTIFY["⚡ Node.js / Fastify"]
    end

    subgraph "Neon (Banco de Dados)"
        PG["🐘 PostgreSQL (Serverless)"]
        POOL["🔄 Connection Pooler (built-in)"]
    end

    subgraph "AWS"
        S3["📦 S3 (Imagens)"]
    end

    subgraph "APIs Externas"
        LLM["🤖 Gemini / Claude API"]
    end

    APP -- "REST + SSE" --> FASTIFY
    APP -- "Presigned URL (upload direto)" --> S3
    FASTIFY -- "Drizzle ORM" --> POOL
    POOL --> PG
    FASTIFY -- "AWS SDK (gera Presigned URL)" --> S3
    FASTIFY -- "Streaming API" --> LLM
```

### 1.1 Componentes e Justificativas

| Componente | Serviço | Justificativa |
|---|---|---|
| **Backend** | Railway (Pro Plan) | Deploy via `git push`, Docker nativo, SSE sem timeout, logs em tempo real, auto-restart |
| **PostgreSQL** | Neon (Serverless) | Connection pooling nativo (resolve "Volta para a Sede" sem PgBouncer), `pgvector` ativável para V2, região `aws-sa-east-1` (São Paulo), escala por uso |
| **Storage** | AWS S3 | Presigned URLs já definidas na arquitetura, custo marginal para imagens |
| **LLM** | API direta (Gemini / Claude) | Sem proxy — o Fastify chama a API do provider diretamente |
| **DNS / SSL** | Railway (automático) | Certificado SSL provisionado automaticamente via Let's Encrypt |

### 1.2 Custos Estimados (MVP)

| Item | Custo Mensal Estimado | Observação |
|---|---|---|
| Railway (Pro) | ~$20 + uso | Base $20, uso de CPU/RAM ~$5-15 |
| Neon (Free → Pro) | $0-19 | Free tier: 0.5GB storage, 100h compute. Suficiente para MVP inicial |
| AWS S3 | ~$1-5 | Armazenamento + transferência de poucas imagens |
| Gemini / Claude API | ~$10-30 | Depende do volume de conversas no chat |
| **Total** | **~$31-89/mês** | |

> [!TIP]
> **Otimização de custo:** No início do MVP (testes internos e beta), o Neon Free Tier (0.5GB, 100h compute/mês) é suficiente. A migração para o plano Pro ($19/mês) é necessária apenas quando o volume de dados ou conexões simultâneas ultrapassar o free tier.

---

## 2. Containerização (Docker)

O backend roda em um container Docker tanto em desenvolvimento local quanto no Railway. Isso garante **paridade entre ambientes** — o que funciona local funciona em produção.

### 2.1 Dockerfile

```dockerfile
# ---- Build Stage ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force
COPY . .
RUN npm run build

# ---- Runtime Stage ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Usuário não-root para segurança
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000
CMD ["node", "dist/server.js"]
```

### 2.2 Docker Compose (Desenvolvimento Local)

```yaml
# docker-compose.yml
version: '3.8'

services:
  api:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - .env
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - ./src:/app/src  # Hot reload em dev

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: agro_diagnostico
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev_password
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dev"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

> [!NOTE]
> O `docker-compose.yml` é usado **apenas para desenvolvimento local**. Em produção, o Railway executa o `Dockerfile` diretamente e o PostgreSQL roda no Neon (serviço gerenciado separado).

---

## 3. Pipeline de CI/CD (GitHub Actions)

O deploy é automatizado via GitHub Actions. O fluxo é:

```plaintext
Developer faz push na branch `main`
        │
        ▼
  GitHub Actions dispara
        │
        ├── 1. Lint (ESLint)
        ├── 2. Type Check (tsc --noEmit)
        ├── 3. Testes (Vitest)
        │
        ▼
  Tudo passou?
        │
    Sim ─────────────────────── Não
     │                           │
     ▼                           ▼
  Railway detecta push        ❌ Build falha
  e faz deploy automático      (notificação no PR)
     │
     ▼
  ✅ Nova versão em produção
```

### 3.1 Workflow de CI

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test
```

### 3.2 Deploy no Railway

O Railway é configurado para **auto-deploy** a partir da branch `main`:

1. Conectar o repositório GitHub ao projeto Railway
2. Railway detecta o `Dockerfile` automaticamente
3. A cada push em `main` (após CI verde), Railway rebuilda e deploya
4. Zero downtime — o container antigo só é desligado após o novo estar healthy

> [!IMPORTANT]
> **Branch strategy:** Desenvolvimento na branch `develop`, merge para `main` apenas via Pull Request com CI verde. Todo push em `main` vai direto para produção.

---

## 4. Variáveis de Ambiente

### 4.1 Template (`.env.example`)

```bash
# ============================================
# Servidor
# ============================================
NODE_ENV=development
PORT=3000
API_PREFIX=/api/v1

# ============================================
# Banco de Dados (Neon PostgreSQL)
# ============================================
# Local (docker-compose)
DATABASE_URL=postgresql://dev:dev_password@localhost:5432/agro_diagnostico
# Produção (Neon) - usar a connection string com pooler
# DATABASE_URL=postgresql://user:pass@ep-xxxx.sa-east-1.aws.neon.tech/agro_diagnostico?sslmode=require

# ============================================
# Autenticação (JWT)
# ============================================
JWT_SECRET=sua-chave-secreta-minimo-32-caracteres
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=30d

# ============================================
# AWS S3 (Imagens)
# ============================================
AWS_REGION=sa-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET_NAME=agro-diagnostico-images
S3_PRESIGNED_EXPIRATION=900

# ============================================
# LLM API
# ============================================
# Gemini
GEMINI_API_KEY=...
# ou Claude
ANTHROPIC_API_KEY=...
LLM_PROVIDER=gemini
LLM_MODEL=gemini-1.5-pro

# ============================================
# Rate Limiting
# ============================================
RATE_LIMIT_GENERAL=100
RATE_LIMIT_CHAT=20
RATE_LIMIT_SYNC=50
RATE_LIMIT_WINDOW_MS=60000
```

### 4.2 Configuração no Railway

As variáveis são configuradas no painel do Railway:
1. Acessar o projeto → Service → Variables
2. Adicionar cada variável individualmente ou importar via `.env`
3. O Railway injeta as variáveis automaticamente no container em runtime

> [!CAUTION]
> **Nunca commitar o `.env` no repositório.** O `.gitignore` deve conter `.env` desde o primeiro commit. Use `.env.example` (sem valores reais) como template para novos desenvolvedores.

---

## 5. Configuração do Neon PostgreSQL

### 5.1 Setup Inicial

1. Criar conta em [neon.tech](https://neon.tech)
2. Criar projeto na região **`aws-sa-east-1`** (São Paulo)
3. Copiar a connection string com pooler:
   ```
   postgresql://user:pass@ep-xxxx-pooler.sa-east-1.aws.neon.tech/agro_diagnostico?sslmode=require
   ```

### 5.2 Connection Pooling (Volta para a Sede)

O Neon oferece **connection pooling nativo** via PgBouncer integrado. Basta usar a connection string que contém `-pooler` no hostname.

| Parâmetro | Valor |
|---|---|
| Modo do pooler | Transaction mode |
| Conexões máximas por endpoint | 100 (free) / 500 (pro) |
| Timeout de conexão idle | 300s |

Isso resolve o cenário "Volta para a Sede" documentado na [[A Arquitetura do PostgreSQL]] (seção 5.3) sem configuração adicional de PgBouncer.

### 5.3 Migrações com Drizzle Kit

```bash
# Gerar migração a partir do schema
npx drizzle-kit generate

# Aplicar migrações no banco
npx drizzle-kit migrate

# Visualizar o schema no Drizzle Studio (UI web)
npx drizzle-kit studio
```

> [!NOTE]
> **Neon branching (futuro):** O Neon permite criar branches do banco de dados (como Git para PostgreSQL). Na V2, isso pode ser usado para testar migrações em uma cópia do banco de produção antes de aplicar.

---

## 6. Configuração do AWS S3

### 6.1 Setup do Bucket

```bash
# Criar bucket na região de São Paulo
aws s3api create-bucket \
  --bucket agro-diagnostico-images \
  --region sa-east-1 \
  --create-bucket-configuration LocationConstraint=sa-east-1

# Bloquear acesso público (segurança)
aws s3api put-public-access-block \
  --bucket agro-diagnostico-images \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

### 6.2 Política IAM (Mínimo Privilégio)

Criar um IAM User dedicado com acesso restrito apenas ao bucket de imagens:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::agro-diagnostico-images/*"
    }
  ]
}
```

> [!WARNING]
> **Nunca use a root account da AWS para gerar as chaves.** Crie um IAM User com a política acima e use as credenciais deste usuário no `.env`. Se as chaves vazarem, o dano fica limitado ao bucket de imagens.

---

## 7. Monitoramento (MVP)

Para o MVP, o monitoramento é **mínimo mas funcional**:

| O que monitorar | Como | Ferramenta |
|---|---|---|
| **Logs do backend** | Saída estruturada (JSON) do Pino (logger do Fastify) | Railway Logs (dashboard web) |
| **Erros não tratados** | Try/catch global + log com stack trace | Railway Logs |
| **Health check** | `GET /api/v1/health` retorna status do DB e uptime | Monitoramento externo (UptimeRobot, free) |
| **Métricas de uso** | CPU, RAM, requests/min | Railway Metrics (dashboard nativo) |
| **Banco de dados** | Query time, conexões ativas | Neon Dashboard |
| **Alertas** | Notificação se o health check falhar | UptimeRobot → Email/Slack |

> [!TIP]
> **UptimeRobot:** Serviço gratuito que pinga o `GET /api/v1/health` a cada 5 minutos e envia um alerta se o servidor não responder. Configuração em 2 minutos, zero custo.

---

## 8. Estratégia de Escalabilidade (MVP → V2)

A migração da Opção A para infraestrutura mais robusta é simples quando o projeto crescer:

```plaintext
MVP (agora)                    V2 (quando escalar)
─────────────────              ─────────────────────
Railway                   →    AWS ECS Fargate
Neon PostgreSQL           →    AWS RDS + PgBouncer
AWS S3                    →    AWS S3 (sem mudança)
GitHub Actions (CI)       →    GitHub Actions (sem mudança)
UptimeRobot               →    AWS CloudWatch + Datadog
```

O código do backend **não muda** — apenas a connection string do banco e o host de deploy. O Drizzle ORM funciona identicamente em ambos os ambientes.

---


