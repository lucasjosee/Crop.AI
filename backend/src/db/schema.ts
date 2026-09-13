import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  doublePrecision,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
  customType,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------
// ENUMS
// ---------------------------------------------------------

export const roleEnum = pgEnum('user_role', ['ADMIN', 'PRODUTOR']);

export const cvStatusEnum = pgEnum('cv_status', [
  'PENDING',
  'CONFIRMED',
  'ENRICHED',
  'DIVERGENT',
  'SKIPPED',
]);

export const ragTypeEnum = pgEnum('rag_entity_type', ['DOENCA', 'DEFENSIVO']);

export const mensagemPapelEnum = pgEnum('mensagem_papel', ['user', 'assistant']);
export const mensagemOrigemEnum = pgEnum('mensagem_origem', ['LOCAL_SLM', 'CLOUD_LLM']);

// Custom type for pgvector placeholder (v2)
const pgVector = customType<{ data: number[] }>({
  dataType() {
    return 'vector(1536)';
  },
});

// ---------------------------------------------------------
// TABLES
// ---------------------------------------------------------

// 1. usuarios
export const usuarios = pgTable('usuarios', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  nome: varchar('nome', { length: 255 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').default('PRODUTOR').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

// 2. refresh_tokens
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => usuarios.id, { onDelete: 'cascade' })
      .notNull(),
    tokenHash: varchar('token_hash', { length: 255 }).unique().notNull(),
    deviceInfo: text('device_info'),
    expiresAt: timestamp('expires_at').notNull(),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_refresh_tokens_user_id').on(table.userId),
  ]
);

// 3. culturas
export const culturas = pgTable(
  'culturas',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    nome: varchar('nome', { length: 255 }).notNull(),
    estagioFenologicoPadrao: jsonb('estagio_fenologico_padrao').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_culturas_updated_at').on(table.updatedAt),
  ]
);

// 4. doencas
export const doencas = pgTable(
  'doencas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    idCultura: varchar('id_cultura', { length: 255 })
      .references(() => culturas.id)
      .notNull(),
    nomeComum: varchar('nome_comum', { length: 255 }).notNull(),
    nomeCientifico: varchar('nome_cientifico', { length: 255 }),
    sintomas: text('sintomas').notNull(),
    nivelSeveridade: integer('nivel_severidade'),
    isActive: boolean('is_active').default(true).notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_doencas_updated_at').on(table.updatedAt),
  ]
);

// 5. defensivos
export const defensivos = pgTable(
  'defensivos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nomeComercial: varchar('nome_comercial', { length: 255 }).notNull(),
    ingredienteAtivo: varchar('ingrediente_ativo', { length: 255 }).notNull(),
    fabricante: varchar('fabricante', { length: 255 }),
    classe: varchar('classe', { length: 255 }).notNull(),
    grupoQuimicoFrac: varchar('grupo_quimico_frac', { length: 255 }),
    bulaResumida: jsonb('bula_resumida').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_defensivos_updated_at').on(table.updatedAt),
  ]
);

// 6. doenca_defensivo
export const doencaDefensivo = pgTable(
  'doenca_defensivo',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    idDoenca: uuid('id_doenca')
      .references(() => doencas.id, { onDelete: 'cascade' })
      .notNull(),
    idDefensivo: uuid('id_defensivo')
      .references(() => defensivos.id, { onDelete: 'cascade' })
      .notNull(),
    dosagemRecomendada: text('dosagem_recomendada').notNull(),
    carenciaDias: integer('carencia_dias').notNull(),
    maxAplicacoesCiclo: integer('max_aplicacoes_ciclo'),
    observacao: text('observacao'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_doenca_defensivo_unique').on(table.idDoenca, table.idDefensivo),
  ]
);

// 7. diagnosticos
export const diagnosticos = pgTable(
  'diagnosticos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => usuarios.id, { onDelete: 'cascade' })
      .notNull(),
    mobileLocalId: uuid('mobile_local_id').unique().notNull(),
    imageS3Key: text('image_s3_key').notNull(),
    // Nulas quando a cross-validation cria a linha antes do sync chegar: (0,0)
    // é uma coordenada real no Golfo da Guiné e ficava indistinguível de leitura
    // legítima se o sync nunca chegasse. O sync preenche quando chega.
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    // Nulo para diagnósticos especiais (Saudável, Fitotoxicidade): são resultados
    // legítimos do CV que não correspondem a nenhuma doença do catálogo.
    doencaId: uuid('doenca_id').references(() => doencas.id),
    confiancaIa: doublePrecision('confianca_ia').notNull(),
    modeloUsado: varchar('modelo_usado', { length: 100 }).notNull(),
    tempoInferenciaMs: integer('tempo_inferencia_ms').notNull(),
    llmDoencaId: uuid('llm_doenca_id').references(() => doencas.id),
    // Preserva o que o LLM afirmou mesmo quando a doença não está no catálogo;
    // sem isso a repetição idempotente devolvia null e escondia a divergência.
    llmDoencaNome: varchar('llm_doenca_nome', { length: 255 }),
    llmConfianca: doublePrecision('llm_confianca'),
    llmObservacoes: text('llm_observacoes'),
    crossValidationStatus: cvStatusEnum('cross_validation_status')
      .default('PENDING')
      .notNull(),
    capturedAt: timestamp('captured_at').notNull(),
    syncedAt: timestamp('synced_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_diagnosticos_user_id').on(table.userId),
    uniqueIndex('idx_diagnosticos_mobile_local_id').on(table.mobileLocalId),
  ]
);

// 8. feedbacks_diagnostico
export const feedbacksDiagnostico = pgTable(
  'feedbacks_diagnostico',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => usuarios.id, { onDelete: 'cascade' })
      .notNull(),
    diagnosticoId: uuid('diagnostico_id').references(() => diagnosticos.id, {
      onDelete: 'set null',
    }),
    mobileLocalId: uuid('mobile_local_id').notNull(),
    status: varchar('status', { length: 50 }).default('PENDING_DIAGNOSTIC').notNull(), // PENDING_DIAGNOSTIC, PROCESSED
    isCorrect: boolean('is_correct').notNull(),
    correctedDoencaId: uuid('corrected_doenca_id').references(() => doencas.id, {
      onDelete: 'set null',
    }),
    userCorrectionNotes: text('user_correction_notes'),
    feedbackAt: timestamp('feedback_at').notNull(),
    syncedAt: timestamp('synced_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_feedbacks_diagnostico_id').on(table.diagnosticoId),
    index('idx_feedbacks_mobile_local_id').on(table.mobileLocalId),
  ]
);

// 9. sessoes_slm
export const sessoesSlm = pgTable(
  'sessoes_slm',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => usuarios.id, { onDelete: 'cascade' })
      .notNull(),
    mobileSessionId: uuid('mobile_session_id').notNull(),
    modelVersion: varchar('model_version', { length: 100 }).notNull(),
    startedAt: timestamp('started_at').notNull(),
    endedAt: timestamp('ended_at').notNull(),
    syncedAt: timestamp('synced_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_sessoes_slm_user_id').on(table.userId),
  ]
);

// 10. interacoes_slm
export const interacoesSlm = pgTable(
  'interacoes_slm',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessaoId: uuid('sessao_id')
      .references(() => sessoesSlm.id, { onDelete: 'cascade' })
      .notNull(),
    prompt: text('prompt').notNull(),
    response: text('response').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    ragUsedDocuments: jsonb('rag_used_documents').default([]).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_interacoes_slm_sessao_id').on(table.sessaoId),
  ]
);

// 9b. conversas — a conversa como unidade, substituindo sessoes_slm
export const conversas = pgTable(
  'conversas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => usuarios.id, { onDelete: 'cascade' })
      .notNull(),
    mobileSessionId: uuid('mobile_session_id').notNull(),
    titulo: varchar('titulo', { length: 255 }).notNull(),
    // Nulo enquanto o diagnóstico de origem não chegou: o sync manda
    // diagnósticos antes, mas um item que falhou na validação deixa a conversa
    // órfã. syncDiagnostics religa quando o diagnóstico entra.
    diagnosticoId: uuid('diagnostico_id').references(() => diagnosticos.id, {
      onDelete: 'set null',
    }),
    mobileDiagnosticLocalId: uuid('mobile_diagnostic_local_id'),
    criadaEm: timestamp('criada_em').notNull(),
    atualizadaEm: timestamp('atualizada_em').notNull(),
    apagadaEm: timestamp('apagada_em'),
    syncedAt: timestamp('synced_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_conversas_user_mobile_session').on(table.userId, table.mobileSessionId),
    index('idx_conversas_user_id').on(table.userId),
  ]
);

// 10b. mensagens — substitui interacoes_slm
export const mensagens = pgTable(
  'mensagens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversaId: uuid('conversa_id')
      .references(() => conversas.id, { onDelete: 'cascade' })
      .notNull(),
    // TEXT e não UUID: a migração v7 do aparelho fabricou ids derivados
    // (`<session_id>-u0`) para não depender de expo-crypto dentro da migração.
    // Declarar uuid faria toda mensagem herdada falhar na validação.
    mobileMessageId: text('mobile_message_id').notNull(),
    papel: mensagemPapelEnum('papel').notNull(),
    conteudo: text('conteudo').notNull(),
    origem: mensagemOrigemEnum('origem'),
    // Só a chave do S3. O resultado do CV e o veredito da segunda opinião
    // vivem em `diagnosticos` e mudam depois; uma cópia aqui envelheceria.
    anexoS3Key: text('anexo_s3_key'),
    latencyMs: integer('latency_ms'),
    criadaEm: timestamp('criada_em').notNull(),
    syncedAt: timestamp('synced_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_mensagens_conversa_mobile_id').on(table.conversaId, table.mobileMessageId),
    index('idx_mensagens_conversa').on(table.conversaId, table.criadaEm),
  ]
);

// 11. documentos_rag (v2 placeholder)
export const documentosRag = pgTable('documentos_rag', {
  id: uuid('id').primaryKey().defaultRandom(),
  tipoEntidade: ragTypeEnum('tipo_entidade').notNull(),
  idEntidade: uuid('id_entidade').notNull(),
  conteudoTexto: text('conteudo_texto').notNull(),
  vetor: text('vetor'), // Placeholder (pgvector deferred to v2)
  isActive: boolean('is_active').default(true).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
