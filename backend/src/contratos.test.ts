import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ZodType } from 'zod';
import {
  syncDiagnosticsSchema,
  diagnosticItemSchema,
  syncFeedbackSchema,
  syncConversationsSchema,
  conversationItemSchema,
} from './modules/sync/sync.schema';
import { chatStreamInputSchema } from './modules/chat/chat.schema';
import { crossValidationInputSchema } from './modules/diagnosis/cross-validation.schema';

// Os mesmos arquivos que o teste do frontend (frontend/lib/contratos.test.ts)
// compara com os corpos montados pelo app. Este lado diz se o servidor os aceita.
// Não usa banco.

interface Caso {
  nome: string;
  corpo: any;
}

function lerContrato(arquivo: string): Caso[] {
  const caminho = resolve(__dirname, '../../contratos', arquivo);
  const casos: Caso[] = JSON.parse(readFileSync(caminho, 'utf-8')).casos;
  expect(casos.length).toBeGreaterThan(0);
  return casos;
}

function aceita(schema: ZodType, valor: unknown, rotulo: string) {
  const r = schema.safeParse(valor);
  expect(r.success, `${rotulo}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true);
}

describe('contrato: o servidor aceita os exemplos de requisição', () => {
  it('POST /sync/diagnostics: envelope e cada item', () => {
    for (const caso of lerContrato('sync-diagnostics.json')) {
      aceita(syncDiagnosticsSchema, caso.corpo, caso.nome);
      for (const item of caso.corpo.diagnostics) aceita(diagnosticItemSchema, item, caso.nome);
    }
  });

  it('POST /sync/feedback', () => {
    for (const caso of lerContrato('sync-feedback.json')) {
      aceita(syncFeedbackSchema, caso.corpo, caso.nome);
    }
  });

  it('POST /sync/conversations: envelope e cada conversa', () => {
    for (const caso of lerContrato('sync-conversations.json')) {
      aceita(syncConversationsSchema, caso.corpo, caso.nome);
      for (const conversa of caso.corpo.conversations) aceita(conversationItemSchema, conversa, caso.nome);
    }
  });

  it('POST /chat/stream (schema strict)', () => {
    for (const caso of lerContrato('chat-stream.json')) {
      aceita(chatStreamInputSchema, caso.corpo, caso.nome);
    }
  });

  it('POST /diagnosis/cross-validate', () => {
    for (const caso of lerContrato('cross-validate.json')) {
      aceita(crossValidationInputSchema, caso.corpo, caso.nome);
    }
  });
});
