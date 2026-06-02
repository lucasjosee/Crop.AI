### F-Evolução 01: Entrega Dinâmica de Modelos (_Dynamic Delivery_ / Aprimoramento Progressivo)

**Descrição:** Para democratizar o acesso e evitar o estrangulamento de hardware (_thermal throttling_ e esgotamento de memória), o sistema não embutirá os modelos SLM no instalador padrão. Durante o primeiro acesso (Onboarding) em rede Wi-Fi, o aplicativo executará um _benchmark_ silencioso do hardware local e baixará o pacote de inteligência offline mais adequado.

**Regras de Negócio e Tiers de Hardware:**

- **Tier 1 (Aparelhos Básicos/Legados):** Download apenas do modelo de Visão Computacional. O recurso de chat offline via SLM é desativado. O sistema faz o _fallback_ para um motor de busca textual (FTS - *Full-Text Search*) direto no Banco de Informações Local. **Nota Técnica:** Para suportar isso, a migração de banco da v2 deverá ativar a extensão FTS5 no `op-sqlite`, indexando as colunas de texto para permitir buscas rápidas sem uso de vetores.
    
- **Tier 2 (Aparelhos Intermediários):** Download de uma SLM de arquitetura leve (ex: modelos sub-3B quantizados). O modelo atua offline de forma mais direta, com respostas curtas e focadas estritamente na extração de dados do RAG.
    
- **Tier 3 (Aparelhos Avançados):** Download de uma SLM robusta (ex: modelos 8B quantizados). Habilita conversação fluida, raciocínio complexo (_Chain of Thought_) e análise aprofundada de sintomas totalmente offline.
    

**Restrição de Arquitetura:** O download dos pesos do modelo deve ocorrer estritamente _Over-The-Air_ (OTA) após a instalação da loja, mantendo o pacote inicial (APK/AAB) leve para facilitar o download em conexões rurais instáveis.
---

