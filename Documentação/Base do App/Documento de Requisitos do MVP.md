## 1. Requisitos de Operação Offline e Gestão de Dados

Para mitigar as limitações cognitivas de modelos compactos (On-device), o sistema implementará uma estratégia de **Busca Estruturada no SQLite Local**. O Banco de Informações Local será consultado de forma relacional (SQL padrão), permitindo que a SLM acesse os metadados de catálogo em tempo real antes de gerar a resposta.

> [!NOTE]
> **Escopo MVP vs v2:** A indexação vetorial (RAG offline na borda via `sqlite-vec`) é um requisito complexo adiado para a **v2**. O SLM passará por um *fine-tuning* na v2 para aprender a interagir com essa estrutura vetorial. No MVP, ele consumirá a bula diretamente da tabela consultada pelo Front-end.

O Banco de Informações Local deve conter:

1. **Catálogo de Doenças:** Glossário técnico, sintomatologia e estágios de desenvolvimento de patologias de soja e milho.
2. **Guia de Defensivos Agrícolas:** Banco de dados de ingredientes ativos, incluindo obrigatoriamente **dosagens recomendadas e diretrizes de segurança/aplicação**.
3. **Base de Conhecimento Agronômico:** Dados sobre ciclos de cultura e manejo de solo para suporte contextual.

## 2. Requisitos Funcionais (RF)

- **RF01 - Diagnóstico Visual:** O sistema deve realizar a inferência local de imagens (capturadas via câmera ou galeria) para identificar patologias com metadados de confiança. O modelo de Visão Computacional (Custom Vision) é o **diagnóstico primário** e funciona 100% offline.
- **RF02 - Recomendação de Tratamento:** O app deve apresentar as opções de defensivos cadastrados no banco local que são indicados para a patologia identificada, exibindo as diretrizes de bula. O sistema deve incluir um disclaimer legal de que a aplicação final exige validação de um engenheiro agrônomo.
- **RF03 - Chat de Agronomia Híbrido:** Interface para perguntas em linguagem natural. Deve processar consultas técnicas (agronomia) e consultas gerais de apoio ao produtor. O LLM de nuvem é multimodal (aceita texto e imagem no mesmo endpoint).
- **RF04 - Failover de Conectividade (Heartbeat):** O app deve implementar um módulo de detecção de conectividade ("Network Sensing"). Se a latência exceder 2000ms ou forem detectados erros HTTP 5xx, o sistema deve redirecionar automaticamente a requisição de inferência para o runtime da LLM On-device. Quando o failover for ativado, a interface precisa avisar o produtor visualmente (ex: um ícone de "Modo Offline" ou "Modo Campo"). Se a SLM responder de forma mais curta ou demorar alguns segundos a mais para processar no hardware do celular, o usuário saberá que é uma limitação de conectividade, e não um bug do aplicativo.
- **RF05 - Sincronização (Store and Forward):** Quando o app operar em modo offline (RF04), todas as fotos tiradas, diagnósticos gerados e logs do chat da SLM devem ser salvos localmente. Assim que o aparelho detectar uma conexão Wi-Fi ou 4G/5G estável, o app exibirá um alerta permitindo que o usuário envie esse pacote de dados mediante **ação manual**. Isso é vital para ter dados reais de campo. *(Nota de Escopo: A sincronização totalmente invisível em background será implementada na v2)*.
- **RF06 - Loop de Feedback do Diagnóstico (Human-in-the-Loop):** Após a IA dar o diagnóstico visual, a interface deve ter botões simples (ex: "Diagnóstico Correto" / "Incorreto" / "Parece ser outra doença"). Se o produtor discordar da IA, ele deve poder digitar ou selecionar qual ele acha que é a doença real. Quando houver divergência entre o CV e o LLM Multimodal (RF08), os botões devem refletir as duas opiniões para o produtor decidir.
- **RF07 - Autenticação e Gestão de Sessão:** O sistema deve permitir o registro de novos usuários (nome, email e senha), login com credenciais, renovação automática de sessão via token de longa duração (Refresh Token com rotação), e logout com revogação imediata do token. O armazenamento dos tokens no dispositivo deve utilizar mecanismos seguros nativos (Keychain no iOS / EncryptedSharedPreferences no Android). A revogação remota deve ser possível em caso de roubo ou extravio do aparelho.
- **RF08 - Cross-Validation Visual (Online):** Quando o app estiver online, a imagem do diagnóstico deve ser enviada ao LLM Multimodal de nuvem em paralelo ao resultado do CV local. O LLM analisa a imagem original e confirma, enriquece ou diverge do diagnóstico primário. A interface exibe o status do cruzamento (✅ Confirmado / 💡 Enriquecido / ⚠️ Divergência). Em caso de divergência, ambas as opiniões são exibidas e o feedback do produtor (RF06) alimenta o ciclo de melhoria de ambos os modelos. Quando offline, o diagnóstico opera apenas com o CV local (sem cross-validation).

## 3. Requisitos Não Funcionais (RNF)

- **RNF01 - Disponibilidade Crítica:** As funcionalidades de diagnóstico e consulta ao catálogo devem manter 100% de disponibilidade em modo offline.
- **RNF02 - Precisão Métricas:** O modelo de visão computacional deve atingir um índice mínimo de **85% de F1-Score** (ou Top-1 Accuracy) no conjunto de validação para as doenças listadas de soja e milho para ser validado como fonte primária.
- **RNF03 - Especialização e Persona:** A LLM em nuvem deve ser instruída via **System Prompt detalhado** para adotar a persona de um "Agrônomo Profissional", priorizando respostas baseadas em evidências científicas e normas técnicas. O System Prompt deve induzir raciocínio do tipo *Chain of Thought (CoT)*, garantindo que o modelo descreva o raciocínio clínico por trás do diagnóstico, não apenas a conclusão.
- **RNF04 - Tempo de Inferência Local:** O modelo de visão computacional deve completar a inferência em no máximo **500ms** no dispositivo alvo, garantindo que o diagnóstico visual pareça instantâneo para o produtor.
- **RNF05 - Consumo de Recursos da SLM:** A SLM on-device não deve consumir mais do que **2GB de RAM** em operação ativa. O arquivo do modelo quantizado (`.gguf`) não deve exceder **1.5GB** de armazenamento em disco para viabilizar a instalação em aparelhos intermediários.
- **RNF06 - Tamanho do Instalador:** No MVP, os modelos de IA (`.gguf` da SLM e `.tflite`/`.mlmodel` do CV) serão **embarcados diretamente no binário do aplicativo**, simplificando a instalação e eliminando a necessidade de download posterior. O pacote final (AAB/IPA) terá tamanho estimado entre **1.5GB e 2GB**. Para viabilizar a distribuição nas lojas, utilizar **Play Asset Delivery** (Android) e **On-Demand Resources** (iOS), que permitem entregar assets pesados de forma transparente. *(Na v2, a distribuição será migrada para OTA com download seletivo por tier de hardware — ver [[Roadmap e Evolução do Produto]]).*

## 4. Diretrizes de Implementação

Para a operação online, o LLM de nuvem operará com um **System Prompt detalhado** aliado a contexto relacional extraído via SQL tradicional (nome da doença, sintomas, defensivos indicados e dosagens) do PostgreSQL. Esse contexto será injetado no prompt antes de cada chamada à API do LLM, garantindo que o "Agrônomo Profissional" tenha acesso aos dados técnicos atualizados sem a necessidade de um pipeline de RAG vetorial no MVP.

Para a operação offline, o foco técnico deve ser a otimização da janela de contexto da SLM através da injeção estruturada dos dados do SQLite local (`SELECT` relacional simples via `op-sqlite`), garantindo que o banco de defensivos e doenças supra a menor capacidade de parametrização do modelo mobile.

> [!NOTE]
> **Motor do banco local:** O motor do banco local será o **op-sqlite** (sucessor de alta performance do SQLite no React Native). A extensão `sqlite-vec` (para busca de similaridade vetorial direto no armazenamento interno sem internet) é escopo da **v2**.

> [!IMPORTANT]
> **Resumo da Estratégia de IA por Fase:**
> - **LLM nuvem (MVP)** → System prompt elaborado + contexto relacional via SQL no PostgreSQL
> - **SLM local (MVP)** → System prompt + `SELECT` relacional simples (op-sqlite)
> - **SLM local (v2)** → System prompt + RAG vetorial (op-sqlite + sqlite-vec)
> - **Fine-tuning Nuvem/SLM** → Fase 2 (v2), após validação do MVP e coleta massiva do *Store and Forward* com usuários reais

---

[[A Base do App]]