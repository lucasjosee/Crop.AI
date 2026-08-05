# Sprint 7 — Homologação de Campo

Este documento separa o que já é garantido pelo código do que precisa ser comprovado em aparelhos, builds de loja e infraestrutura real. Um item só deve ser marcado como aprovado quando houver evidência anexada à execução.

## Estado automatizado

- CI em `.github/workflows/ci.yml`: frontend e backend fazem análise estática, typecheck, testes e build/export; o backend usa PostgreSQL 16 isolado.
- SQLCipher é habilitado na compilação do `op-sqlite` e validado no boot por `isSQLCipher()` e `PRAGMA cipher_version`. Em build nativo, falha de cifra bloqueia o app sem substituir o banco por memória.
- Chaves do banco e tokens usam SecureStore; no iOS, a acessibilidade é `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. O fallback web de sessão só funciona em desenvolvimento.
- Logs do backend redigem autorização, cookies, senhas e tokens. Erros de providers não são devolvidos ao cliente.
- `user_id` é obtido exclusivamente do JWT nos endpoints de upload, sync, chat e cross-validation.
- O carregamento do GGUF continua JIT ao abrir o chat em modo campo. O contexto foi limitado e o modelo é liberado ao sair da tela.
- A duração do boot é registrada como `[Performance] App ready in ...ms`; tempos de inferência já persistidos podem ser resumidos por `readLocalInferencePerformance()` com média e p90.
- O bucket pode ser auditado, com credenciais de homologação, por `cd backend && npm run security:audit-s3`.

## Matriz obrigatória de dispositivos

Registrar versão do app, commit, modelo, SO, RAM total, chipset e resultado para cada linha.

| Perfil | Plataforma | Dispositivo | SO | RAM | Commit | Resultado |
|---|---|---|---|---|---|---|
| Low | Android | A definir | A definir | A definir | A definir | Pendente |
| Mid | Android | A definir | A definir | A definir | A definir | Pendente |
| High | iOS ou Android | A definir | A definir | A definir | A definir | Pendente |

## Performance

1. Fazer build release, sem Metro nem debugger.
2. Em cada dispositivo, executar 30 inferências com o mesmo conjunto representativo de folhas.
3. Exportar `tempo_inferencia_ms`, descartar somente medições comprovadamente inválidas e calcular p90.
4. Aprovar quando p90 for menor ou igual a 500 ms no dispositivo low-end.
5. Medir 10 cold starts; registrar mediana e p90 do log de boot.
6. Medir RAM com Android Studio Profiler ou Xcode Instruments durante: app aberto, CV, carregamento SLM e geração. Aprovar SLM em até 2 GB e pico total CV + SLM em até 2,5 GB.

## Segurança

1. Em build de homologação, confirmar nos logs apenas a presença de `cipher_version`, nunca a chave.
2. Copiar o arquivo do banco de um dispositivo de teste autorizado e tentar abri-lo com SQLite sem chave. Aprovar somente se tabelas e conteúdo forem ilegíveis.
3. Inspecionar Keychain/Keystore no build de teste e confirmar que access token, refresh token e chave do banco não aparecem em preferências ou arquivos em texto claro.
4. Rodar `npm run security:audit-s3` contra o bucket real; os quatro controles de Public Access Block devem estar ativos.
5. Revisar logs do app, Railway e provider após os fluxos E2E procurando JWT, refresh token, senha e chaves de API.

## Fluxos E2E

### Online

Login → câmera → diagnóstico local imediato → upload pré-assinado → segunda opinião → feedback → sync. Validar CONFIRMED, ENRICHED, DIVERGENT, timeout e indisponibilidade.

### Offline

Iniciar em modo avião → diagnóstico → resultado local com `SKIPPED` → chat SLM → feedback pendente → fechar e reabrir → reconectar → sync. Confirmar que nenhum dado foi perdido.

### Edge cases

- Perder conexão durante PUT no storage e confirmar retry sem upload duplicado.
- Expirar access token durante batch e confirmar refresh único antes da repetição.
- Testar Saudável e Fitotoxicidade; ambas devem manter resultado especial, feedback e contexto do chat.
- Executar 10 sessões consecutivas dos fluxos acima sem crash.

## Distribuição e tamanho

Play Asset Delivery, On-Demand Resources e tamanho final só podem ser homologados quando o GGUF distribuível estiver definido (Sprint 4.1), os identificadores de loja estiverem configurados e existirem credenciais de assinatura. Registrar tamanho do AAB/APK e archive/IPA; o limite é 2 GB com os modelos.

## Evidências mínimas para encerrar a Sprint 7

- Relatório das 30 inferências por dispositivo e cálculo de p90.
- Capturas do profiler de memória e tempos de cold start.
- Evidência de banco ilegível sem chave e auditoria S3 aprovada.
- Links dos runs verdes do CI em `main` e do deploy Railway correspondente.
- APK/AAB e archive/IPA com tamanhos registrados.
- Checklist E2E assinado para Android e iOS e dez sessões sem crash.
