Tudo que será implementado no MVP.

O foco principal do app é fazer análises com IA de culturas, como soja e milho,  e devolver para o usuário o diagnostico junto com as ações recomendas para o tratamento da doença. Outra funcionalidade será também o chat com a IA, o cliente poderá fazer perguntas relacionadas a agronomia e outras coisas.
(mais funcionalidades em breve)

O app terá 3 tipos de inteligencia artificial, a primeira e mais importante é o modelo de visão computacional, será a que fará a analise primaria e mais precisa da cultura. O segundo mais importante é a LLM on-device, que seja possível rodar em celulares e substituirá a LLM padrão (gemini, claude, chatGPT) quando não tiver internet, esse modelo terá acesso também a um banco de informações sobre doenças, defensivos agrícolas, e informações mais gerais sobre agronomia. Esse banco de informações é importante, porque,  mesmo sendo uma LLM ela não possuirá a gama de informações necessárias para ter um desempenho satisfatório. E por fim, iremos usar um LLM poderosa, mais provável que seja o claude ou gemini. Iremos realizar um "fine-Tuning" para que ela se comporte como esperamos, e que seja um "agrônomo profissional".

|   |   |   |   |
|---|---|---|---|
|Componente|Função Principal|Modelo/Tecnologia|Conectividade|
|**Visão Computacional**|Análise primária e detecção em tempo real via `react-native-vision-camera`.|Modelo treinado no **Azure Custom Vision**, exportado como CoreML (iOS) e TFLite (Android).|Offline (Local)|
|**LLM On-Device**|Substituição da LLM de nuvem em áreas sem sinal, provendo suporte local.|SLM (Small Language Model) com quantização 4-bit/INT8 para NPU/GPU mobile.|Offline (Local)|
|**LLM em Nuvem**|Atuação como "Agrônomo Profissional" para diagnósticos complexos e lógica avançada.|Gemini 1.5 Pro ou Claude 3.5 Sonnet com Fine-tuning específico.|Online (Cloud)|


[[Documento de Requisitos do MVP]]
[[Arquitetura do App (MVP)]]
[[A Arquitetura do SQLite]]
[[A Arquitetura do Node.js]]
[[A Arquitetura do PostgreSQL]]
[[Contratos de API]]
[[Estratégia de Cross-Validation Visual]]
[[Infraestrutura e Deploy]]
[[Fonte de Dados e Curadoria do Catálogo]]


