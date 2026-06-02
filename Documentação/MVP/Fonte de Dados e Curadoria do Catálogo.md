# Fonte de Dados e Curadoria do Catálogo (MVP)

Este documento define **de onde vêm os dados** das tabelas de domínio (`culturas`, `doencas`, `defensivos`, `doenca_defensivo`), como são curados, validados e inseridos no PostgreSQL. Sem esses dados, o app não funciona — o diagnóstico visual depende do catálogo para exibir tratamentos, e o chat (LLM/SLM) depende dos metadados para injetar contexto relevante no prompt.

---

## 1. Fontes de Dados Oficiais

O catálogo é montado a partir de **3 fontes complementares**, cada uma suprindo um tipo de dado:

```plaintext
┌────────────────────────┐   ┌─────────────────────────┐   ┌───────────────────────┐
│   🏛️ AGROFIT (MAPA)    │   │  🌱 Embrapa             │   │  📄 Bulas Oficiais    │
│                        │   │                         │   │                       │
│  • Defensivos          │   │  • Doenças              │   │  • Diretrizes de      │
│    registrados         │   │  • Sintomas por         │   │    aplicação          │
│  • Ingredientes ativos │   │    estágio              │   │  • EPIs recomendados  │
│  • Dosagens aprovadas  │   │  • Nível de severidade  │   │  • Restrições de uso  │
│  • Período de carência │   │  • Fotos de referência  │   │  • Compatibilidade    │
│  • Culturas-alvo       │   │  • Nome científico      │   │    de misturas        │
│                        │   │                         │   │                       │
│  agrofit.agricultura.  │   │  embrapa.br/soja        │   │  Sites dos            │
│  gov.br                │   │                         │   │  fabricantes          │
└────────────────────────┘   └─────────────────────────┘   └───────────────────────┘
         │                              │                            │
         │     Defensivos,              │     Doenças,               │    Bula
         │     dosagens,                │     sintomas,              │    resumida
         │     carências                │     severidade             │
         │                              │                            │
         └──────────────────┬───────────┴────────────────────────────┘
                            ▼
                 Planilha de Curadoria
                 (CSV / JSON no repo)
                            │
                            ▼
              Revisão por Agrônomo (CREA)
                            │
                            ▼
                  Seed no PostgreSQL
```

### 1.1 AGROFIT — Ministério da Agricultura (MAPA)

**O que é:** Sistema oficial do governo brasileiro com todos os defensivos agrícolas registrados para comercialização e uso no país.

**URL:** [agrofit.agricultura.gov.br](http://agrofit.agricultura.gov.br/agrofit_cons/principal_agrofit_cons)

**Dados extraídos:**

| Campo no app | Campo no AGROFIT |
|---|---|
| `defensivos.nome_comercial` | Nome Comercial |
| `defensivos.ingrediente_ativo` | Ingrediente Ativo |
| `defensivos.classe` | Classe (Fungicida, Inseticida, etc.) |
| `doenca_defensivo.dosagem_recomendada` | Dose (por cultura e alvo) |
| `doenca_defensivo.carencia_dias` | Intervalo de Segurança (dias) |

> [!CAUTION]
> **Requisito legal:** O app **não pode** recomendar um defensivo que não tenha registro ativo no MAPA para a cultura e doença específicas. Um produto registrado para soja não é necessariamente aprovado para milho. A validação cruzada cultura × doença × defensivo deve ser feita na curadoria.

**Método de extração:** Consulta manual no sistema web (filtro por cultura → praga/doença → listar produtos). O AGROFIT não oferece API pública — os dados são extraídos por consulta e organizados manualmente na planilha de curadoria.

### 1.2 Embrapa — Pesquisa Agropecuária

**O que é:** Empresa Brasileira de Pesquisa Agropecuária. Publica guias técnicos gratuitos com descrições detalhadas de doenças, sintomas visuais e recomendações de manejo.

**Publicações de referência para o MVP:**

| Cultura | Publicação | Utilidade |
|---|---|---|
| Soja | *"Tecnologias de Produção de Soja"* | Capítulo de doenças com fotos e severidade |
| Soja | *"Manual de Identificação de Doenças de Soja"* | Fotos de alta qualidade para treino do CV |
| Soja | Circular Técnica — *"Doenças da Soja"* | Descrição de sintomas por estágio fenológico |

**Dados extraídos:**

| Campo no app | Fonte Embrapa |
|---|---|
| `doencas.nome_comum` | Nome popular usado na publicação |
| `doencas.nome_cientifico` | Nome do patógeno (gênero + espécie) |
| `doencas.sintomas` | Descrição textual dos sintomas visuais |
| `doencas.nivel_severidade` | Classificação de impacto na produtividade (1-5) |

### 1.3 Bulas dos Fabricantes

**O que são:** Documentos técnicos oficiais dos fabricantes (Syngenta, BASF, Bayer, Corteva, UPL, FMC, ADAMA) com instruções detalhadas de uso.

**Dados extraídos:**

| Campo no app | Fonte na bula |
|---|---|
| `defensivos.bula_resumida` | Resumo das seções: Modo de Ação, Instruções de Uso, Precauções e Equipamentos de Proteção |

> [!NOTE]
> O campo `bula_resumida` é um **resumo curado** (não a bula inteira). Deve conter: modo de ação (1 frase), momento de aplicação (1-2 frases), volume de calda, e EPIs obrigatórios. A bula completa deve ser referenciada via link externo quando possível.

---

## 2. Escopo do MVP — Soja (Cultura Única)

> [!IMPORTANT]
> O MVP cobre **apenas soja**. O modelo de Visão Computacional foi treinado exclusivamente com imagens de soja no Azure Custom Vision. A inclusão de milho (e outras culturas) depende do treinamento de novos modelos e será implementada em versões futuras.

### 2.1 Tags do Modelo Custom Vision (Azure)

A tabela abaixo lista as **17 tags** já treinadas no modelo. Essas tags definem exatamente quais doenças o catálogo do MVP deve cobrir — cada tag deve ter uma entrada correspondente na tabela `doencas` do banco.

| # | Tag no Custom Vision | Nome Científico do Patógeno | Imagens de Treino | Tipo | Severidade* |
|---|---|---|---|---|---|
| 1 | Antracnose | *Colletotrichum truncatum* | 150 | 🦠 Doença | 3 |
| 2 | Crestamento Bacteriano | *Pseudomonas savastanoi pv. glycinea* | 3791 | 🦠 Doença | 3 |
| 3 | Crestamento Cercospora | *Cercospora kikuchii* | 150 | 🦠 Doença | 3 |
| 4 | Falso Carvão | *Ustilaginoidea virens* | 150 | 🦠 Doença | 2 |
| 5 | Ferrugem | *Phakopsora pachyrhizi* | 2296 | 🦠 Doença | 5 |
| 6 | Fitotoxicidade | — (dano por herbicida/químico) | 1542 | ⚠️ Dano Abiótico | 3 |
| 7 | Folha Carijo | *Cowpea mild mottle virus* (CpMMV) | 311 | 🦠 Doença | 3 |
| 8 | Mancha Alvo | *Corynespora cassiicola* | 982 | 🦠 Doença | 4 |
| 9 | Mancha Mirotécio | *Myrothecium roridum* | 150 | 🦠 Doença | 2 |
| 10 | Mancha Olho de Rã | *Cercospora sojina* | 150 | 🦠 Doença | 3 |
| 11 | Mela | *Rhizoctonia solani* | 150 | 🦠 Doença | 4 |
| 12 | Murcha de Esclerócio | *Sclerotinia sclerotiorum* | 150 | 🦠 Doença | 4 |
| 13 | Míldio | *Peronospora manshurica* | 2332 | 🦠 Doença | 2 |
| 14 | Oídio | *Microsphaera diffusa* | 1308 | 🦠 Doença | 3 |
| 15 | Podridão Phytophthora | *Phytophthora sojae* | 150 | 🦠 Doença | 4 |
| 16 | Septoria (Mancha Parda) | *Septoria glycines* | 1274 | 🦠 Doença | 3 |
| — | **Saudável** | — | 600 | ✅ Controle | — |

**\*Severidade:** Escala de 1 (baixo impacto) a 5 (devastador). Valores de referência — devem ser validados pelo agrônomo consultor.

> [!WARNING]
> **Tags com poucas imagens (150):** Antracnose, Crestamento Cercospora, Falso Carvão, Mancha Mirotécio, Mancha Olho de Rã, Mela, Murcha de Esclerócio e Podridão Phytophthora possuem apenas 150 imagens de treino cada. A acurácia do modelo para essas classes pode ser significativamente menor. Monitorar via telemetria (`confianca_ia`) e priorizar a coleta de mais imagens via Store & Forward para essas tags.

### 2.2 Tratamento Especial: Fitotoxicidade

A tag `Fitotoxicidade` **não é uma doença** — é um dano causado por aplicação incorreta de herbicidas ou produtos químicos. Ela requer tratamento diferente no catálogo:

- Não possui patógeno (campo `nome_cientifico` vazio)
- Não possui defensivos associados (tabela `doenca_defensivo` sem registros para este ID)
- A recomendação na tela deve ser: *"Os sintomas indicam possível fitotoxicidade (dano por herbicida). Consulte um engenheiro agrônomo para avaliar a causa e o manejo adequado."*
- Deve ser armazenada na tabela `doencas` normalmente, mas com um campo ou convenção que a identifique como dano abiótico

### 2.3 Tratamento Especial: Saudável

A tag `Saudável` é a classe de controle — indica que a planta não apresenta sintomas visíveis de doença. No app:

- **Não** é armazenada na tabela `doencas`
- É tratada diretamente na lógica do front-end: se o CV retorna `Saudável`, a tela exibe *"Nenhuma doença detectada. A planta aparenta estar saudável."*
- Não aciona o fluxo de recomendação de tratamento (RF02)

### 2.4 Defensivos Estimados

Com 15 doenças de soja (excluindo Fitotoxicidade e Saudável), o número estimado de defensivos é:

| Métrica | Estimativa |
|---|---|
| Defensivos únicos | ~20-35 produtos |
| Ingredientes ativos distintos | ~10-20 |
| Registros em `doenca_defensivo` | ~40-70 combinações |

A maioria dos fungicidas comerciais cobre múltiplas doenças (ex: Priori Xtra é usado contra Ferrugem, Mancha Alvo e Antracnose), então o número de produtos é menor que o de combinações.

### 2.5 Expansão para Milho (Pós-MVP)

O milho será incluído quando o modelo de Visão Computacional for treinado com imagens de doenças de milho. A inclusão envolve:
1. Treinar novas tags no Azure Custom Vision para milho
2. Exportar o modelo atualizado (CoreML + TFLite)
3. Adicionar a cultura e doenças de milho aos JSONs de seed
4. Publicar nova versão do app com o modelo embarcado atualizado

---

## 3. Estrutura dos Arquivos de Seed

Os dados curados são armazenados no repositório como arquivos JSON, versionados junto com o código:

```plaintext
backend/
  seeds/
    culturas.json
    doencas.json
    defensivos.json
    doenca_defensivo.json
    README.md          ← Documenta a versão dos dados e o agrônomo revisor
```

### 3.1 Formato dos Arquivos

**`culturas.json`**
```json
[
  {
    "id": "cult_soja_001",
    "nome": "Soja",
    "estagio_fenologico_padrao": {
      "vegetativos": ["VE", "VC", "V1", "V2", "V3", "V4", "V5", "V6"],
      "reprodutivos": ["R1", "R2", "R3", "R4", "R5", "R5.1", "R5.5", "R6", "R7", "R8"]
    }
  }
]
```

**`doencas.json`**
```json
[
  {
    "id": "doenca_ferrugem_asiatica",
    "id_cultura": "cult_soja_001",
    "nome_comum": "Ferrugem Asiática",
    "nome_cientifico": "Phakopsora pachyrhizi",
    "sintomas": "Lesões de coloração castanha a marrom-escura na face abaxial das folhas, iniciando nos folíolos inferiores. Em estágio avançado, as pústulas (urédias) liberam esporos de cor castanha visíveis a olho nu. O desfolhamento prematuro é o principal sintoma em infestações severas, podendo causar abortamento de vagens e redução de grãos.",
    "nivel_severidade": 5
  }
]
```

**`defensivos.json`**
```json
[
  {
    "id": "def_priori_xtra",
    "nome_comercial": "Priori Xtra",
    "ingrediente_ativo": "Azoxistrobina + Ciproconazol",
    "classe": "Fungicida",
    "bula_resumida": "Fungicida sistêmico de ação preventiva e curativa. Aplicar preventivamente no aparecimento dos primeiros sintomas ou conforme monitoramento. Volume de calda: 150-200 L/ha. Intervalo entre aplicações: 14-21 dias. EPI obrigatório: macacão, luvas, botas, máscara com filtro."
  }
]
```

**`doenca_defensivo.json`**
```json
[
  {
    "id_doenca": "doenca_ferrugem_asiatica",
    "id_defensivo": "def_priori_xtra",
    "dosagem_recomendada": "300 mL/ha",
    "carencia_dias": 30
  }
]
```

### 3.2 Script de Seed (Drizzle)

```typescript
// seeds/run-seed.ts
import { drizzle } from 'drizzle-orm/neon-http';
import culturasData from './culturas.json';
import doencasData from './doencas.json';
import defensivosData from './defensivos.json';
import relationsData from './doenca_defensivo.json';

async function seed() {
  const db = drizzle(/* connection */);

  console.log('🌱 Seeding culturas...');
  await db.insert(culturas).values(culturasData).onConflictDoNothing();

  console.log('🦠 Seeding doencas...');
  await db.insert(doencas).values(doencasData).onConflictDoNothing();

  console.log('💊 Seeding defensivos...');
  await db.insert(defensivos).values(defensivosData).onConflictDoNothing();

  console.log('🔗 Seeding doenca_defensivo...');
  await db.insert(doencaDefensivo).values(relationsData).onConflictDoNothing();

  console.log('✅ Seed completo!');
}

seed();
```

Executar via npm script:
```bash
npm run seed        # Popular banco local (dev)
npm run seed:prod   # Popular Neon (produção) — executar apenas uma vez
```

---

## 4. Processo de Curadoria

### 4.1 Fluxo de Curadoria

```plaintext
Etapa 1 — Extração (Dev)
  • Consultar AGROFIT para cada cultura × doença
  • Listar defensivos aprovados com dosagens e carências
  • Extrair sintomas das publicações Embrapa
  • Resumir bulas dos fabricantes
  • Preencher os JSONs de seed
  • Tempo estimado: 2-3 dias

Etapa 2 — Revisão Técnica (Agrônomo CREA)
  • Validar a lista de doenças prioritárias
  • Conferir dosagens e carências contra AGROFIT atual
  • Revisar textos de sintomas (precisão técnica)
  • Ajustar severidades para a região-alvo
  • Assinar a versão dos dados (registro no README)
  • Tempo estimado: 1-2 dias

Etapa 3 — Seed e Validação (Dev)
  • Rodar o script de seed no banco de desenvolvimento
  • Verificar integridade referencial (FK doenca_defensivo)
  • Testar queries de contexto do LLM/SLM com dados reais
  • Deploy para Neon (produção)
  • Tempo estimado: 0.5 dia
```

### 4.2 Versionamento dos Dados

Os arquivos de seed são versionados no Git como código. O `README.md` dentro da pasta `/seeds/` deve documentar:

```markdown
# Seed Data — Catálogo Agronômico

## Versão: 1.0.0
## Data da última revisão: 2026-XX-XX
## Revisor: [Nome do Agrônomo] — CREA XX/XXXXX

### Cobertura
- Culturas: Soja (cultura única no MVP)
- Doenças: 16 (15 doenças + 1 dano abiótico)
- Tags do Custom Vision mapeadas: 17 (16 acima + Saudável)
- Defensivos: XX produtos
- Combinações doença×defensivo: XX registros

### Fonte dos dados
- AGROFIT/MAPA: Consultado em [data]
- Embrapa: Publicações referenciadas em cada registro
- Bulas: Versões vigentes em [data]

### Changelog
- v1.0.0: Carga inicial do MVP (soja)
```

> [!WARNING]
> **Os dados agronômicos envelhecem.** O MAPA pode cancelar o registro de um defensivo, novas doenças podem surgir, e dosagens podem ser atualizadas. O catálogo deve ser revisado pelo agrônomo **pelo menos a cada safra** (6 meses). Na V2, um painel administrativo permitirá editar o catálogo via interface web sem precisar alterar JSONs.

---

## 5. Disclaimer Legal

Todo diagnóstico e recomendação exibido no app **deve** ser acompanhado de um disclaimer legal:

```plaintext
⚖️ AVISO: Esta recomendação é gerada por inteligência artificial
com base em dados públicos do MAPA/AGROFIT e publicações da Embrapa.
Tem caráter exclusivamente informativo e não substitui a orientação
de um engenheiro agrônomo habilitado (CREA). A aplicação de
defensivos agrícolas deve seguir as instruções da bula oficial
e a receita agronômica emitida por profissional responsável.
```

> [!CAUTION]
> **A Lei Federal 7.802/1989 (Lei dos Agrotóxicos)** determina que a prescrição de defensivos é atribuição exclusiva de engenheiros agrônomos. O app **recomenda** tratamentos com base em dados oficiais, mas **não prescreve**. Essa distinção deve ser mantida em toda a comunicação e interface do produto.

---


