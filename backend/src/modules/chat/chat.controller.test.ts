// backend/src/modules/chat/chat.controller.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { FastifyReply, FastifyRequest } from 'fastify';

// O controller instancia o ChatService na carga do módulo, então o mock
// delega a um vi.fn hoisted que cada teste reconfigura.
const mocks = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock('./chat.service', () => ({
  ChatService: class {
    stream = mocks.stream;
  },
}));

import { chatController } from './chat.controller';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

function montar() {
  const requestRaw = new EventEmitter();
  const replyRaw = Object.assign(new EventEmitter(), {
    writableFinished: false,
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  });
  const request = {
    body: { session_id: SESSION_ID, message: 'oi' },
    user: { sub: 'u1', role: 'user' },
    headers: {},
    raw: requestRaw,
  } as unknown as FastifyRequest;
  const reply = { hijack: vi.fn(), raw: replyRaw } as unknown as FastifyReply;
  return { request, reply, requestRaw, replyRaw };
}

const tick = () => new Promise((r) => setImmediate(r));

describe('chatController.stream', () => {
  beforeEach(() => {
    mocks.stream.mockReset();
  });

  it('termina com done quando o close do request sai depois de o corpo ser lido', async () => {
    const { request, reply, requestRaw, replyRaw } = montar();
    mocks.stream.mockImplementation(async (_i: unknown, _u: unknown, cb: { onChunk: (t: string) => Promise<void>; onDone: (n: number) => void }) => {
      // No Node >= 16 o IncomingMessage emite close ao fim da leitura do corpo,
      // com o cliente ainda conectado.
      requestRaw.emit('close');
      await cb.onChunk('a');
      await tick();
      await cb.onChunk('b');
      cb.onDone(7);
    });

    await chatController.stream(request, reply);

    expect(replyRaw.write).toHaveBeenCalledWith('data: {"chunk":"a"}\n\n');
    expect(replyRaw.write).toHaveBeenCalledWith('data: {"chunk":"b"}\n\n');
    expect(replyRaw.end).toHaveBeenCalledWith('data: {"done":true,"tokens_used":7}\n\n');
  });

  it('para de escrever quando o cliente fecha a resposta antes do fim', async () => {
    const { request, reply, replyRaw } = montar();
    mocks.stream.mockImplementation(async (_i: unknown, _u: unknown, cb: { onChunk: (t: string) => Promise<void>; onDone: (n: number) => void }) => {
      replyRaw.emit('close'); // writableFinished segue false: o cliente caiu
      await cb.onChunk('a');
      cb.onDone(3);
    });

    await chatController.stream(request, reply);

    expect(replyRaw.write).not.toHaveBeenCalled();
    expect(replyRaw.end).not.toHaveBeenCalled();
  });
});
