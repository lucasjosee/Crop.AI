
Este documento descreve a arquitetura do recurso de **Segmentação de Instância em Tempo Real**, programado para a Versão 2 (V2) do aplicativo. O objetivo desta pipeline é isolar matematicamente a folha da planta do seu plano de fundo (terra, mãos, outras plantas) antes de submetê-la ao classificador de doenças, reduzindo drasticamente os Falsos Positivos e aumentando o F1-Score do diagnóstico.

---

## 1. Visão Geral da Pipeline (Two-Stage Model)

Em vez de um modelo único que tenta achar a folha e a doença ao mesmo tempo (sujeito a ruído visual), a V2 implementa uma arquitetura de dois estágios (Cascade).

1. **Estágio 1 (Localizador/Recortador):** Um modelo de segmentação leve cujo único trabalho é entender "o que é folha" e "o que é fundo".
2. **Transformação Matemática:** O aplicativo recorta os pixels da folha e pinta todo o resto de preto (Background Removal).
3. **Estágio 2 (O Médico):** O modelo de classificação de doenças analisa apenas a imagem limpa.

---

## 2. Fluxo de Processamento (Native/C++)

Para que isso ocorra em menos de 300ms no celular do usuário sem congelar a interface (UI Thread), o processamento ocorre inteiramente na camada nativa (C++) via JSI.

- **Passo A (Captura):** O produtor tira a foto usando a câmera no React Native.
- **Passo B (Inferência de Máscara):** A imagem passa pelo ONNX Runtime rodando um modelo como o `YOLOv8n-seg` (Nano Segmentation). A saída não é um quadrado, mas sim um *Array de Polígonos* mapeando o contorno exato da folha.
- **Passo C (Mascaramento/Masking):** Utilizando um módulo customizado em **C++ nativo (via JSI)**, o aplicativo aplica a máscara sobre a imagem original. Evitamos o uso de `react-native-opencv` pelo seu histórico de instabilidade no ecossistema mobile, operando a matriz de pixels diretamente na memória. Os pixels fora do polígono têm seus canais RGB zerados `(0,0,0)`.
- **Passo D (Classificação Final):** A imagem gerada no Passo C é enviada para o classificador do MVP (RF01), que agora opera em um ambiente visual estéril e sem ruídos.

---

## 3. Requisitos Não Funcionais e Limitações (RNF V2)

### 3.1 Matriz de Hardware (Tier 3 Exclusivo)
Devido ao alto custo computacional de rodar inferência de dois modelos sequenciais mais manipulação matricial de pixels, esta funcionalidade utilizará a estratégia de *Dynamic Delivery* definida no MVP.
- **Regra:** A pipeline de segmentação operará estritamente no **Tier 3** (Dispositivos Avançados com > 6GB RAM e NPUs modernas). 
- **Fallback:** Aparelhos Tier 1 e Tier 2 continuarão utilizando o método de *Bounding Box* padrão (V1).

### 3.2 Impacto no Armazenamento Local (SQLite)
A tabela `fila_diagnosticos` precisará de uma migração de banco de dados para suportar a telemetria do novo processo:
- **Novo Campo:** `image_uri_segmented` (String) - Guarda o caminho da imagem com fundo preto.
- **Novo Campo:** `segmentation_latency_ms` (Inteiro) - Para medir se o aparelho está sofrendo estrangulamento térmico (*thermal throttling*).

### 3.3 Sincronização Assíncrona (Store & Forward)
Para economizar franquia de dados (4G) do produtor e reduzir os custos de AWS S3, o aplicativo enviará para o back-end (Node.js) **apenas a imagem segmentada (`image_uri_segmented`)** e os metadados do polígono. A imagem original crua só será enviada se o produtor utilizar o botão de "Feedback Incorreto" (RF06), exigindo intervenção humana dos engenheiros de IA.
---

