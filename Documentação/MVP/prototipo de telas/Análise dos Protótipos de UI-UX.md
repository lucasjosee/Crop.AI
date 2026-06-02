# Análise dos Protótipos de UI/UX (MVP)

Os protótipos de interface gerados servem como uma **base visual e estrutural** excelente para o aplicativo. Eles trazem uma boa hierarquia de informação e já resolvem alguns requisitos importantes (como o feedback visual de modo offline e sincronização).

No entanto, como os requisitos do MVP evoluíram (especialmente com a inclusão de *Cross-Validation* e *Human-in-the-Loop*), a interface precisará de adaptações na hora da implementação. 

Abaixo documentamos o que deve ser aproveitado e o que precisará ser adicionado.

---

## 1. O que aproveitar dos protótipos ✅

Os protótipos estão sólidos nas seguintes áreas e devem ser usados como referência direta para o desenvolvimento front-end (React Native):

| Componente | Motivo |
|---|---|
| **Câmera (Modo Offline Ativo)** | O *toast* escuro no topo da câmera indicando "Modo Offline Ativo" é a implementação perfeita para o **RF04 (Failover)**. O guia visual ("Centralize a folha doente aqui") é ótimo para reduzir erros de captura. |
| **Diagnóstico (Bottom Sheet)** | O padrão de *bottom sheet* (painel que sobe da parte inferior da tela sobre a imagem) é a melhor escolha de UX para mobile. A hierarquia: severidade → nome da doença → nível de precisão → detalhes, está correta. |
| **Histórico (Sincronização)** | O uso de ícones visuais claros no histórico (☁️ verde para sincronizado, 🔶 laranja/ícone com relógio para pendente) resolve com elegância o requisito de **Store & Forward (RF05)**. |
| **Login (Design System)** | A especificação de bordas (`2px #2E7D32`), cores de status e fontes deve ser convertida diretamente nos tokens de design do Tailwind/stylesheet do app. |
| **Chat (Handoff de Contexto)** | O cabeçalho da mensagem ("Ref: Ferrugem Asiática 95%") ilustra bem como o contexto do diagnóstico visual é passado para o chat. |

---

## 2. Lacunas a serem preenchidas (Deltas de Requisitos) ⚠️

Como vamos usar os protótipos "apenas como base", as seguintes adições precisam ser projetadas na implementação para cobrir os requisitos oficiais (RF06 e RF08):

### 2.1 Adição do Cross-Validation Visual (RF08)
A tela de diagnóstico atual mostra apenas o resultado primário (ex: "Ferrugem Asiática - 95% de precisão"). Precisamos acomodar a segunda opinião do **LLM Multimodal (Agrônomo IA)**:
- **Estado de Loading:** Enquanto aguarda a API, mostrar um indicador não-bloqueante (ex: "Consultando Agrônomo IA...").
- **Estados de Resultado:**
  - ✅ **Confirmado:** "Agrônomo IA confirma o diagnóstico."
  - 💡 **Enriquecido:** Exibir as observações adicionais (ex: deficiência nutricional detectada).
  - ⚠️ **Divergência:** Uma seção de destaque mostrando a segunda suspeita. *(Ex: "Atenção: O Agrônomo IA sugere que os sintomas também se assemelham a Mancha Alvo").*

### 2.2 Botões de Feedback (Human-in-the-Loop - RF06)
A tela de diagnóstico atual possui os botões "Tirar Dúvidas" e "Salvar no Histórico", mas carece do mecanismo de coleta de dados de treino:
- **O que adicionar:** Abaixo do diagnóstico, botões simples para o produtor validar:
  - `[👍 Correto]` 
  - `[👎 Incorreto]` 
  - `[🤔 Parece ser outra doença]`
- **Em caso de divergência:** Se o CV e o LLM discordarem, os botões devem perguntar qual modelo acertou.

---

## 3. Telas Faltantes no Fluxo

O time de desenvolvimento precisará criar as seguintes telas que não foram desenhadas nos protótipos:

1. **Catálogo de Doenças (Enciclopédia):** A aba "Catálogo" aparece na navegação, mas não temos o design da lista de doenças (para busca livre sem foto) nem da página de detalhes do catálogo.
2. **Resultado "Planta Saudável":** O modelo pode retornar a classe "Saudável" (sem patologia). Precisamos da variação verde/positiva da tela de diagnóstico.
3. **Modal de Sincronização:** O RF05 prevê que o envio dos dados locais quando a rede volta depende de **ação manual**. Faltou o alerta/modal: *"Você tem 5 diagnósticos pendentes. Deseja enviar agora?"*

---

## Conclusão

A equipe de Frontend pode extrair toda a **identidade visual**, **tokens de design** e **componentes base** (cards, botões, inputs, abas) diretamente dos protótipos. O esforço de adaptação será concentrado em enriquecer o estado do Bottom Sheet de diagnóstico para suportar o *cross-validation* (RF08) e o painel de botões para feedback do usuário (RF06).
