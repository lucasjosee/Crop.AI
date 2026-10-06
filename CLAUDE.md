# Crop.AI

App **offline-first** que identifica doenças em folhas de soja pela câmera do celular e recomenda tratamento **sem internet** — o cenário normal do produtor rural em campo. Offline não é modo degradado aqui: é o alvo.

Iniciado em 26/05/2026. Autor único. Este arquivo é o contexto mínimo para trabalhar no projeto sem reler tudo.

## Onde está o quê

**O repositório contém só código.** Toda a documentação vive fora dele, em `~/Documentos/Projetos/CropAI-docs`, que **não é git** — não existe commit a fazer lá.

| | |
|---|---|
| `CropAI-docs/README.md` | **Comece por aqui.** Estado, mapa de tudo |
| `CropAI-docs/arquitetura/` | `visao-geral.md`, `offline-first.md`, `ia.md` — os três valem leitura integral |
| `CropAI-docs/referencia/` | `api.md` (13 endpoints), `modelo-de-dados.md` (as duas divergências que quebram em silêncio) |
| `CropAI-docs/especificacoes/` | O design aprovado de cada sub-projeto, escrito antes de implementar |
| `CropAI-docs/historico/execucoes/` | Ledgers: cada decisão tomada durante a implementação e o custo se errada |
| `CropAI-docs/operacao/homologacao-campo.md` | O que a primeira execução achou, e o que um emulador não responde |

`frontend/CLAUDE.md` já existe e carrega uma regra própria: **ler os docs versionados do Expo SDK 56 antes de escrever código de Expo.** As APIs mudaram entre majors e escrever de memória já custou caro aqui — ver "Armadilhas".

## Como se trabalha neste projeto

**O usuário é o arquiteto do produto; eu desenho, planejo, despacho e reviso — não codo.** Implementação vai para subagentes. Restrição de custo explícita: **`sonnet` para implementação e revisão, `haiku` para tarefa mecânica trivial, nunca `opus`/`fable`**. Conserto de uma linha durante revisão é aceitável fazer direto; qualquer coisa substantiva vai para subagente.

**Fluxo de cada sub-projeto**, repetido sete vezes e estável:
`brainstorming` → spec em `especificacoes/` → `writing-plans` → plano em `planos/` → `subagent-driven-development` → PR → ledger arquivado em `historico/execucoes/`.

- **Trabalhar em branch de feature, sem worktree.** Um worktree reinstalaria ~1 GB de `node_modules`.
- **Nunca dois implementadores em paralelo.** A regra foi quebrada uma vez no sub-projeto 5 e dois agentes disputaram o índice do git; um commit saiu com o trabalho de duas tarefas. Revisão *pode* correr em paralelo com a implementação seguinte (revisor é só leitura); **round de correção não pode**, porque também é implementação.
- **Spec e plano são corrigidos em lugar, com nota datada**, quando a execução prova que estavam errados. Já aconteceu em cinco sub-projetos.
- **Commits e PRs sem crédito a nenhuma IA.** Nada de `Co-Authored-By`, nada de "Generated with Claude Code". Exigência do dono do repositório.
- **Código, comentários, mensagens de commit e interface em português.**

## A regra de teste que os agentes mais violam

**O projeto não tem testing-library e não testa componentes nem telas.** A lógica sai da tela para módulos puros em `lib/`, testados com um fake de `dbDriver`; a tela fica fina o bastante para não precisar de teste.

Pedir teste de tela ou de componente a um subagente é **violação de restrição, não cobertura extra**. Quatro das oito tarefas do sub-projeto 7 são de tela e corretamente não têm teste novo — a verificação delas é `npm run typecheck` mais a suíte sem regressão.

## Invariantes que não se cruzam

Cada uma existe por um motivo concreto, e quebrar qualquer uma é bug de produto, não de estilo:

- **O resultado do CV local aparece antes de qualquer chamada de rede.**
- **Divergência entre o CV e o LLM é sempre exibida.** Esconder uma das opiniões pode levar à aplicação errada de defensivo, com dano real na lavoura.
- **`user_id` vem do JWT, nunca do payload.**
- **Foto de lavoura nunca em URL pública** — só presigned de curta duração.
- **O boot falha fechado sem SQLCipher.** Build sem criptografia não inicia, de propósito.
- **Só o servidor produz veredito terminal de cross-validation.** O cliente não pode afirmar `CONFIRMED`/`ENRICHED`/`DIVERGENT`.
- **Nenhuma tela executa SQL.** `lib/chatRepository.ts` é a única porta para `chat_sessions`/`chat_messages`.
- **"Problema", nunca "doença"**, para a classe agregada do mapa: *Fitotoxicidade* é dano químico, e `TipoPino` é `'SAUDAVEL' | 'PROBLEMA'` por isso.
- **Na dúvida sobre a classe, sinalizar — nunca afirmar saúde.** Dizer "planta sadia" sem base é o erro mais caro deste app.

## Armadilhas que já custaram caro

**`any` sobre fronteira nativa — três ocorrências, duas na mesma biblioteca.**
1. `loadModel` em vez de `loadTensorflowModel` (sub-projeto 2)
2. `takePhoto()`, que a `vision-camera` v5 não tem (sub-projeto 3)
3. `TfliteModel.run()` recebe `ArrayBuffer[]`, o código passava `Float32Array` (primeira execução, 27/09/2026)

A terceira é na mesma lib da primeira: consertar o `loadModel` fez o carregamento passar e **só empurrou a falha um passo adiante**, porque se corrigiu a função que aparecia no erro sem auditar o resto da API. **Antes de confiar em qualquer chamada nativa, ler a tipagem instalada** — os `.d.ts` sob `node_modules/<lib>/lib/typescript/` — **e, quando uma biblioteca mentir uma vez, auditar a superfície inteira dela na mesma passada.**

**Barras de navegação falsas.** Existiram na Home e na câmera: três `TouchableOpacity` fazendo `router.push`, com item ativo escrito à mão, mentindo sobre onde o usuário estava. Foram apagadas no sub-projeto 7. A Home v2 vai construir um `Tabs` de verdade — que é outra coisa.

**Nada nunca rodou em aparelho real.** O app rodou pela primeira vez em **27/09/2026, em emulador**. "Código pronto" e "funciona em campo" já divergiram em silêncio por meses, duas vezes.

## Comandos

```bash
# infra + backend
docker compose up -d db minio minio-init
cd backend && npm run db:migrate && npm run db:seed && npm run dev

# testes
cd frontend && npm test          # 260 testes / 26 arquivos
cd backend  && npm test          # 82 / 13 — exige o Postgres do compose no ar
npm run typecheck                # nos dois pacotes

# app no emulador Android (10.0.2.2 é o host visto de dentro do emulador)
emulator -avd Pixel_7 -gpu host
cd frontend && EXPO_PUBLIC_API_URL=http://10.0.2.2:3000 npx expo run:android
```

O app **não roda no Expo Go** — depende de quatro módulos nativos (`op-sqlite` com SQLCipher, `llama.rn`, `react-native-vision-camera`, `react-native-fast-tflite`) e exige *development build*. O pacote Android é `br.com.cropai`.

No emulador a câmera é uma cena 3D falsa: use o **simulador de diagnóstico** sob `__DEV__` (ícone de insetinho na tela da câmera), que roda o pipeline real sem folha.

## Bloqueios conhecidos

| Bloqueio | Efeito |
|---|---|
| **Chave do Google Maps para Android não provisionada** | `/mapa` abre **em branco** no Android; o iOS cai no Apple Maps e funciona. Falha silenciosa: o build passa. Bloqueia a Home v2 |
| **`.gguf` do SLM não é distribuído** (ADR 0001, em aberto) | Chat offline não responde. Cópia manual para `/data/user/0/br.com.cropai/files/models/` |
| **Inferência local quebrada** | `TfliteModel.run()` com tipo errado nas duas pontas — ver Armadilhas. **O diagnóstico por visão não funciona até isso ser consertado** |
| **Sem sync manual** | O sub-projeto 7 removeu o único botão. O automático continua, mas não há retry após falha |

## Onde a documentação mente

Vale saber antes de ser mandado ler algo vazio:

- **`produto/visao.md`, `produto/requisitos.md` e `referencia/configuracao.md` ainda são esqueletos** — só títulos e comentários. Não mande ninguém lê-los esperando conteúdo.
- **Os ADRs 0002 a 0005 foram escritos em 06/10/2026 por reconstrução**, a partir do código e da `api.md`, depois de passarem meses como templates vazios. O *o quê* de cada um é verificado; o *porquê* é inferência marcada no topo de cada arquivo e **ainda não confirmada pelo autor**. O **ADR 0001** (distribuição do SLM) é o único original, e segue *em aberto*.
- Corrigidos em 06/10/2026, para referência: `modelo-de-dados.md` documentava o SQLite até a v7 (está na v9) e listava `fila_slm_logs` como fila viva (a v8 apagou); `ambiente-local.md` dizia 54 e 65 testes (são 260 e 82).

## Estado, em 27/09/2026

A reformulação em sete sub-projetos — *"a conversa é a unidade, e o diagnóstico é a primeira mensagem dela"* — está **completa**. Os sub-projetos 1 a 6 estão em `main`; o **7 está no PR #11**, revisado e aguardando merge.

O próximo trabalho desenhado é a **Home v2** (`especificacoes/2026-09-27-home-v2-design.md`): barra de navegação real, prévia do mapa no topo, Analisar no centro. Está **bloqueada** pela chave do Google Maps.

O passo de maior retorno, porém, não é código: é **rodar em aparelho real**. Com a reformulação fechada, isso deixou de ser um pendente entre outros.
