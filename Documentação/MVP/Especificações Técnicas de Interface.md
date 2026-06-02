# Especificações Técnicas de Interface (Frontend)

Este documento traduz os 5 protótipos visuais gerados em especificações técnicas concretas (Design Tokens) para a implementação do Frontend no React Native. Ele deve servir como o **guia de estilos e medidas** para a construção dos componentes.

---

## Tokens Visuais Base (Design System)

### Paleta de Cores
- **Primary Green (Ações Principais):** `#2E7D32` (CTAs, abas ativas, bordas de input focadas)
- **Light Green (Sucesso):** `#81C784` (Status de sincronizado, ícones de precisão)
- **Burnt Orange (Aviso/Pendente):** `#F57C00` (Status de offline, filas pendentes)
- **Pure White:** `#FFFFFF` (Fundos de tela, cards, search bars, inputs)
- **Almost Black Grey (Texto Forte):** `#212121` (Texto principal de digitação, títulos em destaque)
- **Medium/Dark Grey (Texto Secundário):** `#616161` (Subtítulos, abas inativas, placeholders, labels descritivos)
- **Lead Grey (Bordas):** `#424242` (Bordas inativas de inputs)
- **Light Grey Outline:** `#BDBDBD` (Bordas de botões de login social, divisores suaves)
- **Red Alert:** `#D32F2F` ou similar (Tags de alta severidade e erros críticos)

### Tipografia
- **Fonte Sugerida:** `Inter`, `Roboto` ou `Outfit` (sem-serifa modernas).
- **Títulos/Headers:** Bold ou Semibold, `18px` a `24px`
- **Texto Principal:** Regular, `16px` (ex: Menu de abas, labels de componentes)
- **Texto Secundário/Links:** Semibold, `14px` a `16px` (ex: "Esqueci minha senha", "Cadastre-se")
- **Texto Auxiliar/Datas:** Regular, `12px` a `14px`

### Estrutura, Espaçamentos e Interatividade
- **Bordas (Border Radius):** `12px` (Padrão para cards e inputs quadrados)
- **Pill Shape:** Usado amplamente em botões principais, barras de pesquisa e tags (Border Radius total/circular).
- **Padding e Margens (Base):** `16px`
- **Áreas de Toque (Touch Targets):** Mínimo `48x48 dp` (Garante acessibilidade e facilidade de clique, como no ícone de "revelar senha").
- **Altura Padrão de CTAs e Inputs:** `60 dp`

---

## Especificação e Construção por Tela

### Tela 1: Lista "Meus Diagnósticos"
- **Search Bar:**
  - Formato "Pill Shape" (`borderRadius: 100`). Fundo `#FFFFFF`, Placeholder em Medium Grey, sombra leve (`elevation: 2`).
  - Ícone de lupa posicionado à esquerda no interior do input.
- **Menu de Abas (Tabs):** 
  - Item Inativo: `#616161`, weight `Regular`, `16px`.
  - Item Ativo: `#2E7D32`, weight `Bold`, `16px` com uma linha de destaque (`border-bottom` de uns `3px` sólida).
- **Lista de Cards (Item de Histórico):**
  - Radius do Card: `12px`.
  - Margem inferior entre os itens: `16px`.
  - **Miniatura (Thumbnail):** Imagem da folha com `64x64 dp`, cantos levemente arredondados.
  - Alinhamento: `flex-direction: row`. Imagem à esquerda, bloco centralizado com Título e data/hora em coluna, e Ícone de status isolado na extrema direita.
  - **Status Sincronizado:** Ícone de nuvem com check, traço fino, na cor Light Green `#81C784`.
  - **Status Pendente:** Ícone de nuvem com setas de relógio/refresh, na cor Burnt Orange `#F57C00`.

### Tela 2: Detalhes do Diagnóstico (Card de Resultado)
- **Estrutura (Bottom Sheet):** A imagem escaneada assume o fundo superior da tela em modo `cover`. A seção de informações sobe da parte inferior como um cartão sobreposto (com cantos superiores arredondados e sombra de elevação).
- **Tag de Alerta/Severidade:** Formato pill shape com fundo de baixíssima opacidade (ex: vermelho 10%), ícone de exclamação e texto (ex: `⚠️ Alta`) em cor Red Alert forte.
- **Cabeçalho Principal:** 
  - Nome da doença em fonte Bold, de maior hierarquia (ex: `24px` a `28px`).
  - Subtítulo colado: Ícone verde de check preenchido acompanhado do texto "95% de precisão da IA".
- **Corpo de Informações (Conteúdo):**
  - Layout em lista. Um ícone pequeno à esquerda introduz seções como: Causa (ex: ícone de info), Sintomas (ex: ícone de planta murcha) e Recomendações.
  - Textos descritivos mantêm a cor `Medium Grey` para focar a leitura.
- **Ações Fixas (Rodapé do Bottom Sheet):**
  - **Botão Primário:** "Tirar Dúvidas com Agrônomo Virtual". Fundo `#2E7D32`, texto `#FFFFFF`. Pill shape total com ícone de balão de chat posicionado à direita.
  - **Botão Secundário:** "Salvar no Histórico". Fundo transparente, texto e borda grossa (ex: `2px`) em `#2E7D32`.

### Tela 3: Chat com Agrônomo Virtual
- **Header:** Centralizado superiormente. Inclui um avatar/logo, o Título "Agrônomo Virtual" (Bold, Dark) e o subtítulo "IA de Suporte" em Verde para passar credibilidade.
- **Contexto Pinado:** Bloco de referência cinza claro no topo do fluxo de mensagens. Exibe uma miniatura minúscula da foto e texto de referência "Ref: Ferrugem Asiática (95%)".
- **Sistema de Balões (Messages):**
  - **Usuário:** Fundo branco com outline/borda finíssima e sutil. Alinhado estritamente à direita.
  - **IA (Agrônomo):** Fundo bloco em Primary Green (`#2E7D32`), cor do texto branca (`#FFFFFF`). Alinhado estritamente à esquerda.
  - **Formatação Rica da IA:** O texto da resposta do LLM deve renderizar quebras de linha claras, ícones indicativos e partes em Bold para destacar tópicos chave (ex: 🛡️ Ação, 🧪 Ingrediente Ativo, 💧 Dica).
- **Input Inferior (Chat Box):**
  - Campo de digitação em Pill shape na cor cinza super claro. Placeholder "Digite ou grave um áudio...".
  - Botão de envio/microfone fica **fora** do input, circular (`border-radius: 100`), com fundo Primary Green e ícone em branco, gerando excelente contraste.

### Tela 4: Viewfinder da Câmera
- **Badge de Status Offline:** Pill shape de fundo preto translúcido (opacidade ~60% a 80%), contendo um ícone de nuvem com corte transversal e texto "Modo Offline Ativo". Deve ficar centralizado no topo absoluto (sobrepondo a imagem da câmera).
- **Área Central de Foco:** 
  - Instrução: Target translúcido escuro acima do foco com o texto "Centralize a folha doente aqui".
  - Retângulo: Não possui linhas completas, apenas os 4 cantos ("brackets") brancos e espessos limitando a área central.
- **Controles Inferiores de Captura:**
  - **Shutter (Disparo):** Círculo central grande, fundo `#2E7D32` envolto por um "anel" branco externo de separação, e ícone de câmera branco central.
  - **Acessórios:** Botões circulares brancos menores à esquerda (Galeria) e direita (Flash).
- **Bottom Navigation Bar (Tab Bar):**
  - Fundo branco sólido sem transparências.
  - Contém três itens: Câmera, Chat e Catálogo.
  - O item ativo (Câmera) ganha cor completa (ícone e label em `#2E7D32`). Itens inativos permanecem em Medium Grey.

### Tela 5: Login e Autenticação
- **Layout:** Centralizado e minimalista. Logomarca verde ao centro seguida de um subtítulo em Regular `16px` `#616161`.
- **Inputs Padrão (E-mail e Senha):**
  - Altura maciça: `60 dp` para facilidade de digitação com polegares.
  - Borda default: `2px #424242` Lead Grey.
  - Borda ativa (quando focado): transição para `2px #2E7D32` Primary Green.
  - Label: Estilo embutido na borda superior, fundo branco para cortar a linha do box.
  - O input de senha exige um touch target de no mínimo `48x48 dp` invisível ao redor do ícone do Olho (esconder/mostrar).
- **Ações Auxiliares:** Link "Esqueci minha senha" alinhado à direita logo abaixo do input de senha. Cor verde, weight Semibold. Exige padding transparente generoso para não ser difícil de clicar.
- **Botões (CTAs):**
  - **Entrar (Primário):** Altura `60 dp`, fundo completo `#2E7D32`, pill shape, texto claro e centralizado.
  - Divisor visual: Texto "ou" entre duas linhas horizontais cinzas na cor `#616161`.
  - **Social Login (Secundários):** Altura levemente menor (`56 dp`), outline de `2px` cinza claro (`#BDBDBD`), fundo transparente, ícones e texto escuros, peso Semibold `16px`.
- **Rodapé (Footer):** Texto posicionado na margem inferior absoluta da tela. Parte inicial em Dark Grey e o trecho acionável ("Cadastre-se aqui") evidenciado em Bold `#2E7D32` com uma sutil linha interativa embaixo se necessário.
