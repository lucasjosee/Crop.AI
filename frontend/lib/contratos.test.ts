import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Só as fronteiras que os módulos importam; nenhuma é exercida aqui, porque
// as funções de montagem de corpo são puras.
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('react-native-sse', () => ({ default: class {} }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'gerado' }));
vi.mock('../db/sqlite', () => ({ dbDriver: { execute: vi.fn() } }));
vi.mock('./api', () => ({
  api: { post: vi.fn() },
  refreshAccessToken: vi.fn(),
  refreshFoiRecusado: vi.fn(),
}));
vi.mock('../store/useAuthStore', () => ({ useAuthStore: { getState: () => ({ accessToken: '' }) } }));
vi.mock('../store/useNetworkStore', () => ({ useNetworkStore: { getState: () => ({}) } }));
vi.mock('./diagnosticImageUploadService', () => ({ ensureDiagnosticImageUploaded: vi.fn() }));

import { montarCorpoDiagnosticos, montarCorpoFeedbacks } from './syncService';
import { montarEnvelopes, montarCorpoConversas } from './conversationSyncService';
import { montarCorpoChat } from './engine/cloudEngine';
import { montarCorpoCrossValidate } from './crossValidationService';
import type { ChatAttachment, ChatMessage } from './chatRepository';

interface Caso {
  nome: string;
  corpo: unknown;
}

function lerContrato(arquivo: string): Caso[] {
  const caminho = resolve(__dirname, '../../contratos', arquivo);
  return JSON.parse(readFileSync(caminho, 'utf-8')).casos;
}

/** Cada caso do arquivo tem uma entrada aqui, e cada entrada um caso no arquivo. */
function conferir(arquivo: string, montar: Record<string, () => unknown>) {
  const casos = lerContrato(arquivo);
  expect(casos.map((c) => c.nome).sort()).toEqual(Object.keys(montar).sort());
  for (const caso of casos) {
    // Passa por JSON como o corpo real: undefined some, como na rede.
    expect(JSON.parse(JSON.stringify(montar[caso.nome]()))).toEqual(caso.corpo);
  }
}

const IMG = 'diagnosticos/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111.jpg';

describe('contrato: POST /sync/diagnostics', () => {
  it('o corpo montado pelo app é igual aos exemplos', () => {
    conferir('sync-diagnostics.json', {
      'diagnóstico com posição e segunda opinião confirmada': () =>
        montarCorpoDiagnosticos([
          {
            local_id: '11111111-1111-4111-8111-111111111111',
            timestamp: '2026-07-20T12:00:00.000Z',
            image_s3_key: IMG,
            latitude: -16.6869,
            longitude: -49.2648,
            doenca_id: '33333333-3333-4333-8333-333333333333',
            confianca_ia: 0.91,
            modelo_usado: 'tflite_exemplo_v1.0',
            tempo_inferencia_ms: 48,
            cross_validation_status: 'CONFIRMED',
            llm_doenca_id: '33333333-3333-4333-8333-333333333333',
            llm_confianca: 0.88,
            llm_observacoes: 'A lesão descrita é compatível com a doença indicada pelo modelo local.',
          },
        ]),
      'diagnóstico sem leitura de GPS (location nula)': () =>
        montarCorpoDiagnosticos([
          {
            local_id: '44444444-4444-4444-8444-444444444444',
            timestamp: '2026-07-21T09:30:00.000Z',
            image_s3_key:
              'diagnosticos/22222222-2222-4222-8222-222222222222/44444444-4444-4444-8444-444444444444.jpg',
            latitude: null,
            longitude: null,
            doenca_id: '33333333-3333-4333-8333-333333333333',
            confianca_ia: 0.76,
            modelo_usado: 'tflite_exemplo_v1.0',
            tempo_inferencia_ms: 52,
            cross_validation_status: null,
          },
        ]),
      'classe especial (Saudável) com doenca_id nulo': () =>
        montarCorpoDiagnosticos([
          {
            local_id: '55555555-5555-4555-8555-555555555555',
            timestamp: '2026-07-22T15:45:00.000Z',
            image_s3_key:
              'diagnosticos/22222222-2222-4222-8222-222222222222/55555555-5555-4555-8555-555555555555.jpg',
            latitude: -16.7,
            longitude: -49.3,
            doenca_id: null,
            confianca_ia: 0.95,
            modelo_usado: 'tflite_exemplo_v1.0',
            tempo_inferencia_ms: null,
            cross_validation_status: 'SKIPPED',
          },
        ]),
    });
  });
});

describe('contrato: POST /sync/feedback', () => {
  it('o corpo montado pelo app é igual aos exemplos', () => {
    conferir('sync-feedback.json', {
      'feedback positivo de diagnóstico já sincronizado': () =>
        montarCorpoFeedbacks(
          [
            {
              diagnostic_local_id: '11111111-1111-4111-8111-111111111111',
              timestamp: '2026-07-20T13:00:00.000Z',
              is_correct: 1,
              user_correction_notes: null,
              corrected_doenca_id: null,
            },
          ],
          { '11111111-1111-4111-8111-111111111111': '66666666-6666-4666-8666-666666666666' }
        ),
      'correção do produtor com diagnóstico ainda sem server_id': () =>
        montarCorpoFeedbacks(
          [
            {
              diagnostic_local_id: '44444444-4444-4444-8444-444444444444',
              timestamp: '2026-07-21T10:00:00.000Z',
              is_correct: 0,
              user_correction_notes: 'As manchas surgiram só nas folhas de baixo.',
              corrected_doenca_id: '77777777-7777-4777-8777-777777777777',
            },
          ],
          { '44444444-4444-4444-8444-444444444444': null }
        ),
    });
  });
});

describe('contrato: POST /sync/conversations', () => {
  it('o corpo montado pelo app é igual aos exemplos', () => {
    const anexo = {
      imageUri: 'file:///files/foto.jpg',
      imageS3Key: IMG,
      diagnosticLocalId: '11111111-1111-4111-8111-111111111111',
      cvResult: { diseaseId: 'x', confidence: 0.9, inferenceTimeMs: 1, modelUsed: 'm' },
    };
    conferir('sync-conversations.json', {
      'conversa de diagnóstico com mensagem de foto de conteúdo vazio': () =>
        montarCorpoConversas(
          montarEnvelopes(
            {
              id: '88888888-8888-4888-8888-888888888888',
              title: 'Diagnóstico de exemplo',
              origin_diagnostic_local_id: '11111111-1111-4111-8111-111111111111',
              created_at: '2026-07-20T12:00:00.000Z',
              updated_at: '2026-07-20T12:05:00.000Z',
              deleted_at: null,
            },
            [
              {
                id: '99999999-9999-4999-8999-999999999991',
                role: 'user',
                content: '',
                source: null,
                attachment_json: JSON.stringify(anexo),
                latency_ms: null,
                created_at: '2026-07-20T12:00:00.000Z',
              },
              {
                id: '99999999-9999-4999-8999-999999999992',
                role: 'assistant',
                content: 'Pelo que a foto mostra, o quadro é compatível com a doença indicada.',
                source: 'CLOUD_LLM',
                attachment_json: null,
                latency_ms: 1800,
                created_at: '2026-07-20T12:00:05.000Z',
              },
            ]
          )
        ),
      'conversa renomeada, sem mensagem nova': () =>
        montarCorpoConversas(
          montarEnvelopes(
            {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              title: '',
              origin_diagnostic_local_id: null,
              created_at: '2026-07-23T08:00:00.000Z',
              updated_at: '2026-07-23T08:10:00.000Z',
              deleted_at: null,
            },
            []
          )
        ),
    });
  });
});

describe('contrato: POST /chat/stream', () => {
  const mensagem = (
    id: string,
    role: 'user' | 'assistant',
    content: string,
    extra: Partial<ChatMessage> = {}
  ): ChatMessage => ({
    id,
    sessionId: 's',
    role,
    content,
    source: null,
    attachment: null,
    latencyMs: null,
    createdAt: 't',
    ...extra,
  });

  it('o corpo montado pelo app é igual aos exemplos', () => {
    const fotoFerrugem: ChatAttachment = {
      imageUri: 'file:///files/foto.jpg',
      diseaseName: 'Ferrugem Asiática',
      cvResult: { diseaseId: '33333333-3333-4333-8333-333333333333', confidence: 0.87, inferenceTimeMs: 48, modelUsed: 'tflite_exemplo_v1.0' },
    };
    const fotoSaudavel: ChatAttachment = {
      imageUri: 'file:///files/foto2.jpg',
      cvResult: { diseaseId: 'Saudável', confidence: 0.95, inferenceTimeMs: 40, modelUsed: 'tflite_exemplo_v1.0' },
    };
    const ctx = 'Doença: Ferrugem Asiática. Sintomas: pústulas na face inferior da folha.';

    conferir('chat-stream.json', {
      'conversa livre só de texto': () =>
        montarCorpoChat({
          sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          history: [
            mensagem('1', 'user', 'Minha soja está no estágio R3.'),
            mensagem('2', 'assistant', 'Entendi. Qual sintoma você observa nas folhas?'),
          ],
          userMessage: 'Quando devo aplicar o fungicida?',
          catalogContext: ctx,
        }),
      'foto com mensagem vazia e histórico em que a mensagem antiga é a da foto': () =>
        montarCorpoChat(
          {
            sessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            history: [
              mensagem('1', 'user', '', { attachment: fotoFerrugem }),
              mensagem('2', 'assistant', 'O quadro é compatível com a doença indicada.'),
            ],
            userMessage: '',
            attachment: fotoFerrugem,
            catalogContext: ctx,
          },
          IMG
        ),
      'foto de classe especial (Saudável) com histórico vindo do motor local': () =>
        montarCorpoChat({
          sessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          history: [
            mensagem('1', 'user', 'A folha parece boa?'),
            mensagem('2', 'assistant', 'Sem sinais de doença nesta folha.', { source: 'LOCAL_SLM' }),
          ],
          userMessage: '   ',
          attachment: fotoSaudavel,
          catalogContext: '',
        }),
    });
  });
});

describe('contrato: POST /diagnosis/cross-validate', () => {
  it('o corpo montado pelo app é igual aos exemplos', () => {
    conferir('cross-validate.json', {
      'segunda opinião de diagnóstico com doença do catálogo': () =>
        montarCorpoCrossValidate('11111111-1111-4111-8111-111111111111', IMG, {
          doencaId: '33333333-3333-4333-8333-333333333333',
          doencaNome: 'Ferrugem Asiática',
          confianca: 0.91,
          modeloUsado: 'tflite_exemplo_v1.0',
          tempoInferenciaMs: 48,
        }),
    });
  });
});
