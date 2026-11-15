# contratos/

Um JSON por rota, com requisições de exemplo: `{ "rota": "...", "casos": [{ "nome": "...", "corpo": {...} }] }`.

É a única ponte entre `frontend/` e `backend/`; nenhum pacote importa código do outro.

- **Frontend** (`frontend/lib/contratos.test.ts`): monta cada corpo com as mesmas funções puras que o app usa, a partir de entradas fixas, e exige que seja igual a `corpo` (`toEqual`).
- **Backend** (`backend/src/contratos.test.ts`): valida cada `corpo` com os schemas Zod da rota. Nas rotas de sync, o envelope e cada item.

Mudou o corpo no app: o teste do frontend falha até o exemplo ser atualizado, e o do backend diz se o servidor aceita o exemplo novo. Mudou um schema: o do backend diz se algum exemplo deixou de valer.

Os exemplos usam dados inventados (UUIDs fixos, textos genéricos). Não ponha dado real aqui.
