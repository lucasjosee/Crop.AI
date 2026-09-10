# Crop.AI

Identifica doenças em folhas de soja pela câmera do celular e recomenda
tratamento, **funcionando sem sinal de internet** — que é o cenário normal do
produtor rural em campo.

O diagnóstico visual, o catálogo de defensivos e o chat com o agrônomo virtual
operam offline. Quando há rede, o app envia o que ficou pendente e busca uma
segunda opinião de um modelo multimodal na nuvem.

## Estado

MVP implementado, em transição para *release candidate* de campo. **Não está
pronto para publicação nas lojas.**

| | |
|---|---|
| Culturas | Soja |
| Classes de visão computacional | 17 (16 doenças + Saudável) |
| Testes | 65 backend, 54 frontend |

## Stack

**Frontend** — Expo SDK 56, React Native 0.85, Expo Router, Zustand,
`op-sqlite` com SQLCipher, `llama.rn`, `react-native-vision-camera`,
`react-native-fast-tflite`

**Backend** — Fastify 5, Drizzle ORM, PostgreSQL, S3, Gemini/Claude

Não é um monorepo: são dois projetos npm independentes, cada um com seu
`package.json` e seu lockfile.

## Como funciona

Três componentes de IA, com papéis distintos:

| Componente | Onde roda | Papel |
|---|---|---|
| Visão computacional (TFLite) | Aparelho | **Diagnóstico primário**, 100% offline |
| SLM (`llama.rn`) | Aparelho | Chat quando não há sinal |
| LLM multimodal | Nuvem | Segunda opinião e chat online |

O resultado da visão computacional aparece antes de qualquer chamada de rede. A
segunda opinião da nuvem enriquece depois, e **quando as duas divergem, ambas
são exibidas** — ocultar uma delas poderia levar à aplicação errada de
defensivo.

Sem rede, tudo é gravado em filas locais criptografadas e sincronizado quando a
conexão volta.

## Rodando localmente

Requer Node 22, Docker e um *development build* — o app depende de módulos
nativos e **não roda no Expo Go**.

```bash
cp .env.example .env          # preencha JWT_SECRET e LLM_API_KEY
docker compose up -d db minio minio-init

cd backend
npm ci
npm run db:migrate
npm run db:seed
npm run dev                   # http://localhost:3000
```

Em outro terminal:

```bash
cd frontend
npm ci
npx expo start
```

Verifique com:

```bash
curl http://localhost:3000/api/v1/health
```

### Testes

```bash
cd backend  && npm test       # exige o PostgreSQL do compose no ar
cd frontend && npm test
```

### Limitação conhecida

O **chat offline exige que o modelo `.gguf` já esteja no aparelho**. A
distribuição automática do modelo ainda não foi implementada; hoje o arquivo
precisa ser copiado manualmente para `documentDirectory/models/`. Sem ele, o
Modo Campo não responde.

## Estrutura

```
backend/    API Fastify, schema Drizzle e integrações
frontend/   Aplicativo Expo / React Native
seed/       Catálogo de doenças e defensivos em JSON
```

## Aviso legal

As recomendações de defensivos vêm de um catálogo curado a partir do AGROFIT e
de publicações da Embrapa, e **exigem validação de engenheiro agrônomo** antes
da aplicação, conforme a Lei 7.802/1989. O aplicativo exibe esse aviso em toda
recomendação.

Este software não substitui avaliação profissional. As classes de visão
computacional foram treinadas com conjuntos de tamanhos desiguais, e a acurácia
varia entre elas.
