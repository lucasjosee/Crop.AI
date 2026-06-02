# Contratos de API (Back-end)

Este documento define os contratos de API RESTful para a comunicação entre o App de Diagnóstico (Mobile) e o Back-end (Node.js). A arquitetura prioriza o funcionamento _offline-first_, utilizando o padrão **Store and Forward** para enviar dados acumulados quando a conexão é restabelecida.

---

## Convenções Gerais

### Segurança e Autenticação
Todos os endpoints (exceto os de autenticação e health check) requerem autenticação via Token JWT. O cabeçalho obrigatório em todas as requisições autenticadas é:
`Authorization: Bearer <seu_token_jwt>`

**Importante:** Os payloads de requisição NÃO possuem o campo `user_id` por questões de segurança e integridade de autoria. O back-end deve extrair a identidade do usuário lendo e validando o token JWT nos cabeçalhos HTTP. Todas as chamadas de API devem ocorrer estritamente em HTTPS.

### Formato Padrão de Respostas de Erro

Toda resposta de erro da API deve seguir a estrutura abaixo para que o front-end consiga tratar os erros de forma consistente:

```json
{
  "error": {
    "code": "CÓDIGO_DO_ERRO",
    "message": "Descrição legível para logs ou debug.",
    "details": []
  }
}
```

**Tabela de Códigos de Erro:**

| HTTP Status | `code` | Quando Ocorre |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Payload malformado ou campos inválidos. O array `details` conterá os campos rejeitados pelo validador JSON Schema do Fastify. |
| `401` | `TOKEN_EXPIRED` | O Access Token expirou. O app deve disparar o fluxo de refresh automaticamente. |
| `401` | `INVALID_CREDENTIALS` | Email ou senha incorretos (mensagem genérica para evitar enumeração de usuários). |
| `403` | `REFRESH_DENIED` | O Refresh Token é inválido, expirou, ou foi revogado. O app deve exigir novo login com senha. |
| `404` | `NOT_FOUND` | Recurso não encontrado. |
| `409` | `CONFLICT` | Recurso já existe (ex: email já cadastrado no registro). |
| `429` | `RATE_LIMITED` | Limite de requisições excedido. Consultar header `Retry-After`. |
| `500` | `INTERNAL_ERROR` | Erro inesperado do servidor. |

### Rate Limiting

Para proteger a API contra abusos e garantir estabilidade durante o cenário de "Volta para a Sede" (rajadas de sync), todas as rotas possuem limites de taxa. Os headers informativos são incluídos em toda resposta:

| Header | Descrição |
|---|---|
| `X-RateLimit-Limit` | Número máximo de requisições permitidas na janela. |
| `X-RateLimit-Remaining` | Quantidade de requisições restantes na janela atual. |
| `Retry-After` | Segundos até a janela resetar (incluído apenas quando `429` é retornado). |

**Limites por categoria:**

| Categoria | Limite | Janela |
|---|---|---|
| Autenticação (`/auth/*`) | 10 requisições | 1 minuto |
| Chat Streaming (`/chat/*`) | 20 requisições | 1 minuto |
| Sincronização (`/sync/*`) | 30 requisições | 1 minuto |
| Catálogo (`/catalog/*`) | 60 requisições | 1 minuto |

> [!NOTE]
> Os limites de sincronização são deliberadamente generosos para acomodar as rajadas do *Store and Forward* no cenário "Volta para a Sede". Caso o produtor esgote o limite, o app deve enfileirar os lotes restantes e reenviá-los após o `Retry-After`.

---

## 1. Health Check (Conectividade)

Endpoint público (sem autenticação) utilizado pelo módulo de **Network Sensing** (RF04) para verificar a disponibilidade do servidor e medir a latência. O app dispara este ping antes de decidir entre Modo Online (LLM Nuvem) e Modo Campo (SLM Local).

**`GET /api/v1/health`**

**Headers:** Nenhum obrigatório.

**Response (200 OK):**
```json
{
  "status": "ok",
  "timestamp": "2026-05-22T12:00:00Z"
}
```

> [!TIP]
> O payload é intencionalmente mínimo para não consumir dados móveis do produtor. O app deve considerar qualquer resposta em menos de **2000ms** como conexão estável. Timeout ou erro = ativar Modo Campo.

---

## 2. Autenticação

Endpoints responsáveis pelo ciclo de vida da sessão do usuário (RF07). Os endpoints de registro e login **não** requerem o header `Authorization`, pois o usuário ainda não possui um token.

### 2.1 Registro de Usuário

**`POST /api/v1/auth/register`**

**Headers:**
- `Content-Type: application/json`

**Request Body (JSON):**
```json
{
  "nome": "João da Silva",
  "email": "joao@fazenda.com",
  "password": "senhaSegura123!"
}
```

**Validações do Servidor:**
- `nome`: String não vazia, entre 2 e 100 caracteres.
- `email`: Formato de email válido (padrão internacional). Único no sistema.
- `password`: Mínimo de 8 caracteres.

**Response (201 Created):**
```json
{
  "user": {
    "id": "uuid-do-usuario",
    "nome": "João da Silva",
    "email": "joao@fazenda.com",
    "role": "PRODUTOR",
    "created_at": "2026-05-22T08:00:00Z"
  }
}
```

**Erros Possíveis:**
| Status | Código | Causa |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Campos ausentes, email inválido ou senha fraca. |
| `409` | `CONFLICT` | Email já cadastrado no sistema. |

### 2.2 Login

**`POST /api/v1/auth/login`**

**Headers:**
- `Content-Type: application/json`

**Request Body (JSON):**
```json
{
  "email": "joao@fazenda.com",
  "password": "senhaSegura123!",
  "device_info": "Samsung Galaxy A54 - Android 14"
}
```

> [!NOTE]
> O campo `device_info` é opcional e serve para identificar qual aparelho gerou a sessão na tabela `refresh_tokens`, permitindo ao ADMIN ou ao próprio usuário identificar sessões ativas em caso de roubo.

**Response (200 OK):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "opaque-token-uuid-alta-entropia",
  "expires_in": 900,
  "token_type": "Bearer"
}
```

| Campo | Descrição |
|---|---|
| `access_token` | JWT assinado com HS256. Contém `sub` (user ID) e `role`. Expira em **15 minutos**. |
| `refresh_token` | Token opaco de alta entropia. Armazenado como hash no banco. Expira em **30 dias**. |
| `expires_in` | Tempo de vida do access token em segundos (900 = 15 min). |

**Erros Possíveis:**
| Status | Código | Causa |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Campos ausentes ou formato inválido. |
| `401` | `INVALID_CREDENTIALS` | Email não encontrado ou senha incorreta (mensagem genérica). |

### 2.3 Renovação de Token (Refresh)

O app deve disparar este fluxo automaticamente ao receber um `401 TOKEN_EXPIRED` ou ao detectar que o `expires_in` está próximo de zerar.

**`POST /api/v1/auth/refresh`**

**Headers:**
- `Content-Type: application/json`

**Request Body (JSON):**
```json
{
  "refresh_token": "opaque-token-uuid-alta-entropia"
}
```

**Response (200 OK):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...(novo)...",
  "refresh_token": "novo-opaque-token-uuid",
  "expires_in": 900,
  "token_type": "Bearer"
}
```

> [!IMPORTANT]
> **Rotação Obrigatória:** O servidor invalida o refresh token antigo e emite um novo par a cada chamada. Isso previne ataques de interceptação. Se o app tentar reutilizar um refresh token já rotacionado, o servidor deve revogar **todas** as sessões daquele usuário como medida de segurança (possível roubo de token).

**Erros Possíveis:**
| Status | Código | Causa |
|---|---|---|
| `403` | `REFRESH_DENIED` | Token inválido, expirado ou já revogado. O app deve exigir novo login. |

### 2.4 Logout (Revogação de Sessão)

**`POST /api/v1/auth/logout`**

**Headers:**
- `Authorization: Bearer <jwt>`
- `Content-Type: application/json`

**Request Body (JSON):**
```json
{
  "refresh_token": "opaque-token-uuid-alta-entropia"
}
```

**Response (200 OK):**
```json
{
  "status": "success"
}
```

Após o sucesso, o app deve descartar ambos os tokens do armazenamento seguro local (Keychain / EncryptedSharedPreferences).

---

## 3. Chat Inteligente em Nuvem (Agrônomo Profissional)
Responsável por processar dúvidas complexas usando o modelo LLM Multimodal na nuvem (Gemini/Claude) quando o dispositivo possui conexão com a internet (Atende ao RF03). O endpoint aceita texto e opcionalmente imagem (multimodal). Para evitar travamento da interface, utiliza **Server-Sent Events (SSE)** para _streaming_ em tempo real.

> [!WARNING]
> **Aviso de Implementação (React Native / Expo):** O motor JavaScript padrão do React Native (mesmo utilizando Hermes) possui uma limitação histórica na API `fetch` nativa para lidar com streams. Por padrão, ele pode tentar realizar o *buffer* do pacote inteiro antes de renderizar a resposta, quebrando o efeito "palavra por palavra". Durante a implementação do front-end, utilize uma biblioteca específica (ex: `react-native-sse`) ou estabeleça uma ponte nativa simples para garantir que o stream flua em tempo real.

**`POST /api/v1/chat/stream`**

**Headers:**
- `Authorization: Bearer <jwt>`
- `Accept: text/event-stream`

**Request Body (JSON):**
```json
{
  "session_id": "uuid-da-sessao",
  "message": "A ferrugem asiática já está no estágio avançado, qual a dosagem de Priori Xtra?",
  "image_s3_key": "diagnostics/user-123/2026-05-23/abc123.jpg",
  "context": {
    "cultura": "Soja",
    "doenca_identificada": "Ferrugem Asiática",
    "confianca_visao": 0.92
  },
  "history": [
    {"role": "user", "content": "Olá, achei umas manchas nas folhas."},
    {"role": "assistant", "content": "Pode me dar mais detalhes ou enviar uma foto?"}
  ]
}
```

> [!NOTE]
> O campo `image_s3_key` é **opcional**. Quando presente, o backend baixa a imagem do S3 e a inclui no prompt multimodal do LLM (Gemini Vision / Claude Vision). Isso permite que o produtor envie fotos diretamente no chat para perguntas visuais como "o que essa planta tem?". Quando ausente, o comportamento é de chat texto puro.


**Response (Streaming via SSE):**
```text
data: {"chunk": "Como "}
data: {"chunk": "a ferrugem "}
data: {"chunk": "já está em estágio avançado, "}
data: {"chunk": "a recomendação "}
data: {"chunk": "é... "}
data: {"done": true, "tokens_used": 145}
```

**Erros Possíveis:**
| Status | Código | Causa |
|---|---|---|
| `400` | `VALIDATION_ERROR` | `session_id` ou `message` ausentes. |
| `401` | `TOKEN_EXPIRED` | Access token expirado. |
| `502` | `LLM_UNAVAILABLE` | A API do provedor de LLM (Gemini/Claude) está fora do ar ou retornou erro. O app deve ativar o fallback para SLM local. |

---

## 4. Upload de Imagens (Presigned URL)

Para evitar que o servidor Node.js seja gargalo de tráfego binário, o upload de imagens dos diagnósticos é feito **diretamente do celular para o AWS S3** utilizando URLs pré-assinadas. O fluxo ocorre em dois passos: (1) o app solicita uma URL de upload ao back-end, (2) o app envia a imagem direto ao S3.

```plaintext
[App Mobile]                    [Node.js]                   [AWS S3]
     |                              |                           |
     |-- (1) POST /upload/url ----->| (Gera Presigned PUT URL)  |
     |<-- { upload_url, s3_key } ---|                           |
     |                              |                           |
     |-- (2) PUT upload_url --------|-------------------------->|
     |   (Envia bytes da imagem)    |                           |
     |<-- 200 OK -------------------|---------------------------|
     |                              |                           |
     |-- (3) POST /sync/diagnostics (com s3_key) -->|           |
```

### 4.1 Solicitar URL de Upload

**`POST /api/v1/upload/url`**

**Headers:**
- `Authorization: Bearer <jwt>`

**Request Body (JSON):**
```json
{
  "filename": "diagnostico_2026-05-22_083000.jpg",
  "content_type": "image/jpeg"
}
```

**Validações do Servidor:**
- `content_type`: Deve ser `image/jpeg` ou `image/png`. Outros formatos são rejeitados.
- O presigned URL gerado terá validade de **10 minutos** e tamanho máximo de **10MB**.

**Response (200 OK):**
```json
{
  "upload_url": "https://bucket-name.s3.amazonaws.com/diagnosticos/uuid-usuario/uuid-imagem.jpg?X-Amz-Algorithm=...",
  "s3_key": "diagnosticos/uuid-usuario/uuid-imagem.jpg",
  "expires_in": 600
}
```

| Campo | Descrição |
|---|---|
| `upload_url` | URL pré-assinada para upload via `PUT`. O app envia os bytes da imagem diretamente para essa URL. |
| `s3_key` | Identificador do arquivo no S3. Deve ser enviado no campo `image_s3_key` do endpoint de sincronização de diagnósticos. |
| `expires_in` | Tempo de validade da URL em segundos. |

### 4.2 Envio da Imagem (Direto ao S3)

**`PUT <upload_url>`** *(URL retornada no passo anterior)*

**Headers:**
- `Content-Type: image/jpeg` *(deve corresponder ao `content_type` informado)*

**Body:** Bytes binários da imagem (raw binary).

**Response (200 OK):** Resposta do S3 confirmando o upload. Sem body relevante.

> [!CAUTION]
> **Ordem das Operações:** O app **deve** completar o upload da imagem ao S3 (passo 2) **antes** de incluir o `s3_key` no payload de sincronização de diagnósticos (passo 3). Caso o upload falhe (ex: conexão caiu no meio), o app deve reter o diagnóstico na `fila_diagnosticos` local com status `PENDING` e tentar novamente na próxima sincronização.

**Erros Possíveis:**
| Status | Código | Causa |
|---|---|---|
| `400` | `VALIDATION_ERROR` | `content_type` não suportado ou `filename` ausente. |
| `401` | `TOKEN_EXPIRED` | Access token expirado. |

---

## 5. Sincronização de Diagnósticos (Store & Forward)
Sincroniza o lote de diagnósticos feitos offline. É devolvido o `server_id` gerado para cada diagnóstico. As imagens já devem ter sido enviadas ao S3 (seção 4) antes desta chamada.

**`POST /api/v1/sync/diagnostics`**

**Headers:**
- `Authorization: Bearer <jwt>`

**Request Body (JSON):**
```json
{
  "diagnostics": [
    {
      "local_id": "uuid-gerado-no-sqlite-do-celular",
      "timestamp": "2026-05-22T08:30:00Z",
      "image_s3_key": "diagnosticos/uuid-usuario/uuid-imagem.jpg",
      "location": {
        "lat": -23.55052,
        "lng": -46.633309
      },
      "ai_result": {
        "doenca_id": "ferrugem_asiatica_01",
        "confianca": 0.88,
        "modelo_usado": "coreml_v1.2",
        "tempo_inferencia_ms": 45
      }
    }
  ]
}
```

> [!NOTE]
> **Formato do campo `modelo_usado`:** Seguir o padrão `{runtime}_{versão}` para rastreabilidade. Valores esperados: `coreml_v1.0`, `tflite_v1.0`, etc. A versão reflete a iteração do modelo treinado no Azure Custom Vision.

**Response (200 OK):**
```json
{
  "status": "success",
  "synced_count": 1,
  "failed_count": 0,
  "synced_items": [
    {
      "local_id": "uuid-gerado-no-sqlite-do-celular",
      "server_id": "uuid-persistido-no-backend-001"
    }
  ],
  "failed_items": []
}
```

Quando um ou mais itens do lote falharem (ex: `doenca_id` inválido), a API ainda retorna `200 OK` com o detalhamento parcial:
```json
{
  "status": "partial",
  "synced_count": 2,
  "failed_count": 1,
  "synced_items": [
    { "local_id": "uuid-1", "server_id": "server-uuid-1" },
    { "local_id": "uuid-2", "server_id": "server-uuid-2" }
  ],
  "failed_items": [
    {
      "local_id": "uuid-3",
      "error_code": "INVALID_DOENCA_ID",
      "message": "O doenca_id informado não existe no catálogo."
    }
  ]
}
```

---

## 6. Feedback do Produtor (Human-in-the-Loop)
Sincroniza as validações manuais do produtor sobre os diagnósticos da IA (RF06/RF08). Quando o diagnóstico possui cross-validation com divergência, o feedback do produtor indica qual das duas IAs acertou. Segue o mesmo padrão de batch com detalhamento por item.

**`POST /api/v1/sync/feedback`**

**Headers:**
- `Authorization: Bearer <jwt>`

**Request Body (JSON):**
```json
{
  "feedbacks": [
    {
      "diagnostic_server_id": "uuid-persistido-no-backend-001",
      "diagnostic_local_id": "uuid-gerado-no-sqlite-do-celular",
      "timestamp_feedback": "2026-05-22T08:35:00Z",
      "is_correct": false,
      "user_correction_notes": "Não era ferrugem, era mancha alvo.",
      "corrected_doenca_id": "mancha_alvo_01"
    }
  ]
}
```

**Response (202 Accepted):**
```json
{
  "status": "success",
  "processed_count": 1,
  "failed_count": 0,
  "processed_items": [
    {
      "diagnostic_local_id": "uuid-gerado-no-sqlite-do-celular",
      "feedback_id": "uuid-do-feedback-no-servidor"
    }
  ],
  "failed_items": []
}
```

> [!NOTE]
> **Feedback antes do Diagnóstico:** É possível que o feedback chegue ao servidor antes do diagnóstico correspondente (se o lote de diagnósticos ainda não foi sincronizado). O back-end deve aceitar o feedback usando o `diagnostic_local_id` como referência temporária, marcando-o com status `PENDING_DIAGNOSTIC` até que o diagnóstico correspondente seja sincronizado e vinculado.

---

## 7. Sincronização de Logs da SLM (Modelos Locais)
Coleta o histórico de conversas em ambiente puramente offline para auditoria e coleta de dados para o fine-tuning futuro (v2).

**`POST /api/v1/sync/slm-logs`**

**Headers:**
- `Authorization: Bearer <jwt>`

**Request Body (JSON):**
```json
{
  "slm_sessions": [
    {
      "session_id": "uuid-sessao-offline",
      "started_at": "2026-05-21T14:00:00Z",
      "model_version": "gemma_2b_q4",
      "interactions": [
        {
          "prompt": "Como aplico fungicida na chuva?",
          "response": "Recomenda-se adicionar espalhante adesivo...",
          "latency_ms": 3200,
          "rag_used_documents": []
        }
      ]
    }
  ]
}
```

> [!NOTE]
> No MVP, o campo `rag_used_documents` deve ser enviado como **array vazio** `[]`, pois o RAG vetorial é escopo da v2. O campo é mantido no contrato para garantir retrocompatibilidade quando a v2 for lançada.

**Response (202 Accepted):**
```json
{
  "status": "success",
  "processed_count": 1
}
```

---

## 8. Sincronização de Catálogo

Atualiza as tabelas de domínio do SQLite local (doenças, culturas, defensivos) com as alterações mais recentes do PostgreSQL. O endpoint suporta verificação de Hash (ETag) e paginação baseada em cursor para eficiência.

O app envia a versão do seu banco local no header. Se o servidor constatar que é a mais recente, evita transferir dados desnecessários retornando 304.

**`GET /api/v1/catalog/sync`**

**Headers:**
- `Authorization: Bearer <jwt>`
- `If-None-Match: "hash_versao_atual_celular_xyz123"`

**Query Params:**
- `cursor`: Ponteiro da página atual para trazer os próximos itens.
- `limit`: Quantidade de atualizações desejadas na resposta.

**Response (200 OK):**
*(Se nenhuma atualização ocorrer, retorna `304 Not Modified` vazio)*
```json
{
  "catalog_version_hash": "nova_versao_abc456",
  "next_cursor": "cursor_proximo_registro...",
  "has_more": false,
  "updates": {
    "doencas": [
      { "action": "upsert", "data": { "id": "nova_doenca_01", "nome": "Mancha Alvo" } }
    ],
    "defensivos": [
      { "action": "delete", "id": "defensivo_descontinuado_09" }
    ]
  }
}
```

---

## 9. Cross-Validation Visual (RF08)

Quando o app está online e o produtor faz um diagnóstico, a imagem é enviada ao LLM Multimodal para uma segunda análise que confirma, enriquece ou diverge do resultado do Custom Vision local. O resultado do CV é enviado junto como "âncora" para o LLM.

**`POST /api/v1/diagnosis/cross-validate`**

**Headers:**
- `Authorization: Bearer <jwt>`

**Request Body (JSON):**
```json
{
  "diagnostic_local_id": "uuid-gerado-no-sqlite-do-celular",
  "image_s3_key": "diagnostics/user-123/2026-05-23/abc123.jpg",
  "cv_result": {
    "doenca_id": "doenca_ferrugem",
    "doenca_nome": "Ferrugem",
    "confianca": 0.92,
    "modelo_usado": "coreml_v1.0",
    "tempo_inferencia_ms": 47
  }
}
```

**Response (JSON):**
```json
{
  "status": "success",
  "cross_validation": {
    "result_status": "ENRICHED",
    "llm_agrees_with_cv": true,
    "llm_doenca_id": null,
    "llm_doenca_nome": null,
    "llm_observacoes": "Confirmo a Ferrugem Asiática (Phakopsora pachyrhizi). As pústulas na face abaxial são consistentes com o estágio R5. Adicionalmente, noto amarelecimento internerval nas folhas inferiores — possível deficiência de manganês. Recomendo análise foliar complementar.",
    "llm_confianca": 0.88
  }
}
```

**Cenários de `result_status`:**

| Status | `llm_agrees_with_cv` | `llm_doenca_id` | Significado |
|---|---|---|---|
| `CONFIRMED` | `true` | `null` | LLM concorda com o CV. Sem observações extras. |
| `ENRICHED` | `true` | `null` | LLM concorda e adicionou observações (deficiências, saúde geral). |
| `DIVERGENT` | `false` | ID da doença que o LLM sugere | LLM discorda do CV. Ambas opiniões são exibidas. |

**Exemplo de resposta `DIVERGENT`:**
```json
{
  "status": "success",
  "cross_validation": {
    "result_status": "DIVERGENT",
    "llm_agrees_with_cv": false,
    "llm_doenca_id": "doenca_mancha_alvo",
    "llm_doenca_nome": "Mancha Alvo",
    "llm_observacoes": "O padrão de lesões circulares com halo amarelado me parece mais consistente com Mancha Alvo (Corynespora cassiicola) do que com Ferrugem Asiática.",
    "llm_confianca": 0.75
  }
}
```

> [!NOTE]
> **Endpoint não-blocking:** O diagnóstico primário (CV) já está na tela do produtor antes desta chamada retornar. A cross-validation é uma **segunda opinião assíncrona** — o front-end exibe um loader ("Consultando Agrônomo IA...") e atualiza a tela quando a resposta chega (~3-5s).

> [!IMPORTANT]
> **Quando offline:** Este endpoint não é chamado. O campo `cross_validation_status` do diagnóstico local fica como `SKIPPED`. Quando o diagnóstico for sincronizado via Store & Forward (Seção 5), o backend **pode opcionalmente** executar a cross-validation no servidor nesse momento (se a imagem estiver disponível no S3), preenchendo os campos retroativamente.

**Erros Possíveis:**
| Status | Código | Causa |
|---|---|---|
| `400` | `VALIDATION_ERROR` | `image_s3_key` ou `cv_result` ausentes. |
| `401` | `TOKEN_EXPIRED` | Access token expirado. |
| `404` | `IMAGE_NOT_FOUND` | A imagem referenciada não existe no S3. |
| `502` | `LLM_UNAVAILABLE` | A API do provedor LLM está fora do ar. O app deve ignorar a cross-validation e manter apenas o resultado do CV. |
| `504` | `LLM_TIMEOUT` | O LLM demorou mais de 15s para responder. Tratar como `SKIPPED`. |

---



