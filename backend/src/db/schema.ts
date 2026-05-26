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
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    doencaId: uuid('doenca_id')
      .references(() => doencas.id)
      .notNull(),
    confiancaIa: doublePrecision('confianca_ia').notNull(),
    modeloUsado: varchar('modelo_usado', { length: 100 }).notNull(),
    tempoInferenciaMs: integer('tempo_inferencia_ms').notNull(),
    llmDoencaId: uuid('llm_doenca_id').references(() => doencas.id),
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
