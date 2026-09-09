# Estratégia de Cross-Validation Visual

Este documento define a arquitetura de **validação cruzada** entre o modelo de Visão Computacional (Custom Vision) e o LLM Multimodal de nuvem. Implementada desde o **MVP** (RF08), o objetivo é cruzar o diagnóstico especializado do CV com a análise visual generalista do LLM Multimodal, enriquecendo o resultado e detectando divergências.

---

## 1. O Problema

Sem cross-validation, o fluxo de análise visual é unidirecional:

```plaintext
Foto → Custom Vision (local) → "Ferrugem Asiática (92%)" → texto no prompt
                                                                ↓
                                                     LLM/SLM só vê TEXTO
                                                     (nunca viu a imagem)
```

**Consequência:** Se o produtor perguntar *"como está a saúde geral dessa planta?"*, *"tem deficiência de nutriente?"* ou *"o que é aquela mancha no fundo?"*, a SLM não consegue responder — ela não tem acesso visual à foto original. Com a cross-validation ativa (online), o LLM Multimodal **vê a imagem** e pode responder essas perguntas.

---

## 2. Arquitetura de Cross-Validation

O MVP implementa um sistema de **duas análises paralelas** que se complementam (quando online):

```plaintext
                            ┌─────────────────────────────┐
                            │          📸 Foto             │
                            └─────────┬───────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                     ▼
        ┌───────────────────┐               ┌───────────────────────┐
        │  🔬 Custom Vision  │               │  ☁️ LLM Multimodal    │
        │  (Local, ~50ms)    │               │  (Nuvem, ~3-5s)       │
        │                    │               │                       │
        │  Especialista:     │               │  Generalista:         │
        │  - Classifica a    │      ┌───────▶│  - Vê a foto inteira  │
        │    doença com alta │      │        │  - Analisa contexto   │
        │    precisão        │      │        │    visual completo    │
        │  - Treinado para   │──────┘        │  - Recebe o resultado │
        │    doenças         │  resultado    │    do CV como âncora  │
        │    específicas     │  do CV é      │  - Responde perguntas │
        │                    │  enviado      │    abertas            │
        └────────┬──────────┘  como input   └───────────┬───────────┘
                 │                                       │
                 └──────────────┬─────────────────────────┘
                                ▼
                    ┌───────────────────────┐
                    │   Cruzamento dos      │
                    │   Resultados          │
                    │                       │
                    │  ✅ Confirmação       │
                    │  ⚠️ Divergência       │
                    │  💡 Enriquecimento    │
                    └───────────────────────┘
```

### 2.1 Papel de Cada Componente

| Componente | Força | Fraqueza | Papel no V2 |
|---|---|---|---|
| **Custom Vision** (local) | Precisão altíssima para doenças treinadas | Só enxerga o que foi treinado para classificar | **Diagnóstico primário** — rápido e confiável |
| **LLM Multimodal** (nuvem) | Vê tudo na imagem (solo, folha, contexto) | Menos preciso para classificação específica de doenças | **Segunda opinião + análise visual ampla** |

> [!IMPORTANT]
> O Custom Vision **continua sendo o diagnóstico primário**. O LLM Multimodal não o substitui — ele **complementa** com capacidade visual generalista que o CV não possui.

### 2.2 Fluxo Online Detalhado

```plaintext
1. Produtor aponta câmera / seleciona foto da galeria

2. Custom Vision roda LOCALMENTE (~50ms)
   → Resultado: { doenca: "Ferrugem Asiática", confiança: 0.92 }
   → Interface já exibe o diagnóstico preliminar instantaneamente

3. EM PARALELO, a imagem é enviada ao backend:
   POST /api/v1/diagnosis/cross-validate
   Body: { image_s3_key, cv_result: { doenca, confiança } }

4. O backend recebe a imagem e monta o prompt multimodal:
   [System Prompt do Agrônomo]
   + [Resultado do CV como âncora: "O modelo especializado identificou..."]
   + [Imagem original]
   + [Instrução: "Analise a imagem. Confirme ou conteste o diagnóstico.
      Além disso, avalie a saúde geral da planta."]

5. O LLM Multimodal retorna a análise completa via SSE streaming

6. A interface atualiza o card de diagnóstico com:
   - Resultado do CV (primário, já exibido)
   - Opinião do LLM (segunda análise)
   - Observações adicionais (saúde geral, nutrientes, etc.)
   - Status: ✅ Confirmado | ⚠️ Divergência | 💡 Enriquecido
```

> [!NOTE]
> **UX crucial:** O resultado do Custom Vision aparece **instantaneamente** (~50ms). A análise do LLM chega **depois** (~3-5s) como um enriquecimento progressivo. O produtor nunca espera — ele já tem o diagnóstico primário enquanto a segunda opinião carrega.

### 2.3 Fluxo Offline (Modo Campo)

Quando offline, o LLM Multimodal não está disponível. O diagnóstico opera **apenas com o CV local** e o `cross_validation_status` é salvo como `SKIPPED`. Na **V2**, o CV será re-treinado como modelo multi-label para extrair metadados extras:

```plaintext
Custom Vision V2 (retrained, escopo futuro):
  - doenca_primaria: "Ferrugem Asiática" (92%)
  - doenca_secundaria: "Mancha Alvo" (34%)           ← V2
  - saude_geral: 0.45 (escala 0-1)                   ← V2
  - cor_predominante: "amarelecimento parcial"        ← V2
  - estagio_vegetativo_estimado: "R5.1"               ← V2
  - areas_afetadas: "terço superior, face abaxial"    ← V2
```

No MVP (offline), a SLM recebe apenas o resultado simples do CV (1 doença + confiança).

---

## 3. Tratamento de Resultados Cruzados

### 3.1 Os 3 Cenários de Cruzamento

**Cenário 1 — Confirmação (✅)**
O LLM concorda com o CV.

```plaintext
🔬 CV:  "Ferrugem Asiática (92%)"
☁️ LLM: "Concordo. As pústulas na face abaxial são consistentes
         com Ferrugem Asiática (Phakopsora pachyrhizi) em estágio R5."

→ Interface: ✅ Diagnóstico confirmado por ambas as análises
→ Confiança agregada: ALTA
```

**Cenário 2 — Enriquecimento (💡)**
O LLM confirma a doença e adiciona observações que o CV não detecta.

```plaintext
🔬 CV:  "Ferrugem Asiática (92%)"
☁️ LLM: "Confirmo a Ferrugem Asiática. Adicionalmente, identifico
         amarelecimento internerval nas folhas inferiores — possível
         deficiência de manganês. Recomendo análise foliar."

→ Interface: ✅ Diagnóstico confirmado + 💡 Observações adicionais
→ Confiança agregada: ALTA
```

**Cenário 3 — Divergência (⚠️)**
O LLM discorda do CV. Este é o caso mais valioso.

```plaintext
🔬 CV:  "Ferrugem Asiática (92%)"
☁️ LLM: "O padrão de lesões circulares com halo amarelado me parece
         mais consistente com Mancha Alvo (Corynespora cassiicola)
         do que com Ferrugem Asiática."

→ Interface: ⚠️ As análises divergiram — avalie com um agrônomo
→ Confiança agregada: INCERTA (exige revisão humana)
```

### 3.2 Regras de Prioridade

| Situação | Diagnóstico Exibido | Justificativa |
|---|---|---|
| CV e LLM concordam | CV (com selo ✅ "Confirmado") | CV é primário, LLM reforça |
| CV alta confiança + LLM enriquece | CV + observações do LLM | O melhor dos dois mundos |
| CV alta confiança + LLM diverge | **Ambos**, com flag ⚠️ | Não suprimir nenhum — dado valioso |
| CV baixa confiança (< 70%) + LLM diverge | LLM como sugestão principal, CV como secundária | CV incerto, LLM pode ter visto melhor |
| CV alta confiança + LLM indisponível | Apenas CV (sem selo) | Fluxo degradado = igual ao MVP |

> [!CAUTION]
> **Nunca ocultar uma divergência.** Se o CV diz A e o LLM diz B, o produtor deve ver os dois. Ocultar uma das opiniões é perigoso — a aplicação incorreta de defensivo pode causar danos reais à lavoura.

---

## 4. O Ciclo Virtuoso — Divergências como Dados de Treino

As discrepâncias entre CV e LLM, combinadas com o feedback do produtor (RF06), formam um **sistema de auto-melhoria**:

```plaintext
┌─────────────────────────────────────────────────────────┐
│                   CICLO DE MELHORIA                      │
│                                                          │
│   CV diz A + LLM diz A + Produtor confirma A            │
│   └──→ Reforço positivo para ambos os modelos            │
│                                                          │
│   CV diz A + LLM diz B + Produtor confirma A            │
│   └──→ Dado de fine-tuning para o LLM (ele errou)        │
│                                                          │
│   CV diz A + LLM diz B + Produtor confirma B            │
│   └──→ Dado de re-treino para o CV (ele errou)           │
│        + Caso para revisão pelo time de agronomia        │
│                                                          │
│   CV diz A + LLM diz A + Produtor diz C                 │
│   └──→ AMBOS erraram — caso raro e valiosíssimo          │
│        Prioridade máxima para análise manual              │
│                                                          │
│   Todos esses dados fluem via Store & Forward             │
│   e alimentam o pipeline de fine-tuning da V2             │
└─────────────────────────────────────────────────────────┘
```

### 4.1 Estrutura do Dado de Discrepância

A tabela `diagnosticos` no PostgreSQL já possui os campos de cross-validation desde o MVP:

```plaintext
diagnosticos:
  - cv_doenca_id          (FK - resultado do Custom Vision) ← já existe como doenca_id
  - cv_confianca          (Float) ← já existe como confianca_ia
  - llm_doenca_id         (FK - resultado do LLM Multimodal, nullable)
  - llm_confianca         (Float, nullable)
  - llm_observacoes       (Text - análise adicional: saúde geral, nutrientes, etc.)
  - cross_validation_status (Enum: PENDING, CONFIRMED, ENRICHED, DIVERGENT, SKIPPED)
  - feedback_doenca_id    (FK - correção do produtor via RF06, nullable)
```

Essa estrutura permite queries analíticas poderosas:

```sql
-- Quais doenças o CV mais erra vs o LLM?
SELECT cv_doenca_id, llm_doenca_id, COUNT(*)
FROM diagnosticos
WHERE cross_validation_status = 'DIVERGENT'
  AND feedback_doenca_id = llm_doenca_id  -- produtor concordou com o LLM
GROUP BY cv_doenca_id, llm_doenca_id
ORDER BY COUNT(*) DESC;

-- Taxa de acerto do CV vs LLM quando divergem
SELECT
  COUNT(*) FILTER (WHERE feedback_doenca_id = cv_doenca_id) AS cv_acertou,
  COUNT(*) FILTER (WHERE feedback_doenca_id = llm_doenca_id) AS llm_acertou,
  COUNT(*) FILTER (WHERE feedback_doenca_id NOT IN (cv_doenca_id, llm_doenca_id)) AS ambos_erraram
FROM diagnosticos
WHERE cross_validation_status = 'DIVERGENT'
  AND feedback_doenca_id IS NOT NULL;
```

---

## 5. Impacto na UX

### 5.1 Card de Diagnóstico (V2)

```plaintext
┌──────────────────────────────────────────────────┐
│  📸 Diagnóstico                                   │
│                                                   │
│  🔬 Modelo de Visão:  Ferrugem Asiática (92%)     │
│  ☁️ Agrônomo IA:      ✅ Confirma                 │
│                                                   │
│  💊 Tratamento recomendado:                       │
│  • Priori Xtra — 300ml/ha — Carência: 30 dias    │
│  • Opera — 500ml/ha — Carência: 30 dias          │
│                                                   │
│  💡 Observações do Agrônomo:                      │
│  "A planta apresenta sinais iniciais de           │
│   deficiência de manganês nas folhas do terço     │
│   médio. Recomendo análise foliar complementar."  │
│                                                   │
│  ⚖️ Disclaimer: Esta recomendação é informativa.  │
│  Consulte um engenheiro agrônomo (CREA).          │
│                                                   │
│  [👍 Correto]  [👎 Incorreto]  [🤔 Outra doença] │
└──────────────────────────────────────────────────┘
```

### 5.2 Card com Divergência

```plaintext
┌──────────────────────────────────────────────────┐
│  📸 Diagnóstico                                   │
│                                                   │
│  🔬 Modelo de Visão:  Ferrugem Asiática (92%)     │
│  ☁️ Agrônomo IA:      ⚠️ Divergência              │
│  "O padrão de lesões me parece mais consistente   │
│   com Mancha Alvo (Corynespora cassiicola)."      │
│                                                   │
│  ┌────────────────────────────────────────────┐   │
│  │  ⚠️ As duas análises divergiram.           │   │
│  │  Considere consultar um engenheiro         │   │
│  │  agrônomo para confirmar o diagnóstico.    │   │
│  └────────────────────────────────────────────┘   │
│                                                   │
│  Sua avaliação ajuda a melhorar nossos modelos:   │
│  [É Ferrugem]  [É Mancha Alvo]  [🤔 Outra]       │
└──────────────────────────────────────────────────┘
```

---

## 6. Requisitos Técnicos

### 6.1 Dependências

| Componente | Tecnologia | Observação |
|---|---|---|
| **LLM Multimodal** | Gemini 2.0 Flash (Vision) ou Claude Sonnet (Vision) | Suporte nativo a imagem + texto |
| **Custom Vision** | Azure Custom Vision exportado como CoreML (iOS) e TFLite (Android) | 16 doenças de soja + Saúdavel |
| **API** | `POST /api/v1/diagnosis/cross-validate` | Endpoint que aceita image_s3_key + cv_result |
| **Armazenamento** | S3 (imagens) + PostgreSQL (metadados expandidos) | Campos de cross-validation na tabela `diagnosticos` |

### 6.2 Estimativa de Custos Adicionais

| Item | Custo Estimado |
|---|---|
| Gemini 2.0 Flash (imagem + texto) | ~$0.002/imagem (~2000 tokens input) |
| Armazenamento S3 (imagem original mantida) | ~$0.023/GB/mês |
| **Custo por diagnóstico online** | **~$0.003** (CV local é gratuito) |

> [!NOTE]
> O custo adicional por diagnóstico é marginal (~R$0,015 por análise). Para 1.000 diagnósticos/mês, o custo total do LLM multimodal seria ~R$15/mês.

### 6.3 Impacto nas APIs Existentes

| Endpoint | Mudança |
|---|---|
| `POST /api/v1/sync/diagnostics` | Campos: `llm_doenca_id`, `llm_confianca`, `llm_observacoes`, `cross_validation_status` |
| `POST /api/v1/sync/feedback` | Sem mudança — já suporta `corrected_doenca_id` |
| `POST /api/v1/diagnosis/cross-validate` | Endpoint de cross-validation (RF08) |

---

## 7. Resumo da Estratégia por Modo

| Modo | Diagnóstico Primário | Análise Visual Ampla | Cross-Validation |
|---|---|---|---|
| **Online (MVP)** | Custom Vision (local) | ☁️ LLM Multimodal (imagem + texto) | ✅ Completa (RF08) |
| **Offline (MVP)** | Custom Vision (local) | ❌ Não disponível (SKIPPED) | ❌ Apenas CV |
| **Online (V2)** | Custom Vision (local) | ☁️ LLM Multimodal (imagem + texto) | ✅ Completa |
| **Offline (V2)** | Custom Vision Enriquecido | 📱 SLM + metadados do CV | ⚠️ Parcial |

---

## 8. Decisões da Implementação MVP (Sprint 6)

Implementação consolidada em 20/07/2026:

- O resultado do CV local é renderizado antes de persistência, upload ou chamada de rede. A segunda opinião é um enriquecimento progressivo e nunca bloqueia o fluxo offline.
- O diagnóstico recebe `diagnostic_local_id` e entra em `fila_diagnosticos` imediatamente após a inferência. A migração SQLite v5 adiciona os campos de cross-validation via `PRAGMA user_version`, sem recriar tabelas.
- O upload continua em dois passos. `image_s3_key` é persistido logo após o PUT e reutilizado pelo cross-validation, pelo chat e pela sincronização posterior.
- O backend estende a abstração `LLMProvider` com análise multimodal estruturada. Gemini e Claude recebem imagem, âncora do CV e catálogo permitido; a resposta é validada antes de persistir.
- `diagnostic_local_id` + usuário autenticado formam a chave idempotente da operação. Quando o cross-validation chega antes do sync do diagnóstico, o backend cria o registro pendente e o endpoint de sync hidrata depois os metadados locais sem sobrescrever uma segunda opinião já finalizada.
- O `image_s3_key` precisa estar no prefixo do usuário extraído do JWT. `user_id` no body é rejeitado.
- Offline, casos especiais (`Saudável` e `Fitotoxicidade`) e falhas de LLM permanecem utilizáveis com status local `SKIPPED`; o código específico da falha fica somente no SQLite para diagnóstico operacional.
- Divergências sempre exibem as duas opiniões. A LLM só ganha destaque primário quando a confiança do CV é inferior a 70%, sem ocultar o resultado local.
- Feedback é gravado em `fila_feedbacks` por `diagnostic_local_id`, inclusive antes do diagnóstico possuir `server_id`.

Ficaram explicitamente fora do escopo: RAG vetorial, background sync, download/distribuição do GGUF e qualquer recurso V2.

