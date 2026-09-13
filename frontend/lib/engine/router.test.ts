import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EngineRouter, RELEASE_AFTER_ONLINE_MS, PROBING_WAIT_MS } from './router';
import type { ConversationEngine, EngineCallbacks, EngineInput, EngineKind } from './types';
import type { ConnectionMode } from '../../config/network';

/** Motor falso que guarda os callbacks para o teste simular tokens e erros. */
function fakeEngine(kind: EngineKind, ready: boolean) {
  const engine = {
    kind,
    _ready: ready,
    captured: null as EngineCallbacks | null,
    isReady: () => engine._ready,
    prepare: vi.fn(async (onProgress: (p: number) => void) => {
      onProgress(0.5);
      engine._ready = true;
      return true;
    }),
    release: vi.fn(async () => {
      engine._ready = false;
    }),
    respond: vi.fn((_input: EngineInput, cb: EngineCallbacks) => {
      engine.captured = cb;
    }),
  };
  return engine as typeof engine & ConversationEngine;
}

/** Store de rede falso com subscribe compatível com o Zustand. */
function fakeNetwork(initial: ConnectionMode) {
  let mode = initial;
  const listeners = new Set<(s: { connectionMode: ConnectionMode }) => void>();
  return {
    getState: () => ({ connectionMode: mode }),
    subscribe: (fn: (s: { connectionMode: ConnectionMode }) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set(next: ConnectionMode) {
      mode = next;
      listeners.forEach((fn) => fn({ connectionMode: next }));
    },
  };
}

const input: EngineInput = { sessionId: 's', history: [], userMessage: 'oi', catalogContext: '' };

function callbacks() {
  return { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
}

describe('EngineRouter', () => {
  afterEach(() => vi.useRealTimers());

  describe('escolha do motor por modo', () => {
    it('ONLINE responde pela cloud', () => {
      const local = fakeEngine('LOCAL', false);
      const cloud = fakeEngine('CLOUD', true);
      const router = new EngineRouter(local, cloud, fakeNetwork('ONLINE'));

      router.respond(input, callbacks(), new AbortController().signal);

      expect(cloud.respond).toHaveBeenCalledTimes(1);
      expect(local.respond).not.toHaveBeenCalled();
      expect(router.currentKind()).toBe('CLOUD');
    });

    it('FIELD com modelo pronto responde pela local', () => {
      const local = fakeEngine('LOCAL', true);
      const cloud = fakeEngine('CLOUD', true);
      const router = new EngineRouter(local, cloud, fakeNetwork('FIELD'));

      router.respond(input, callbacks(), new AbortController().signal);

      expect(local.respond).toHaveBeenCalledTimes(1);
      expect(cloud.respond).not.toHaveBeenCalled();
      expect(router.currentKind()).toBe('LOCAL');
    });

    it('FIELD com modelo não pronto carrega antes, reportando progresso, e então responde', async () => {
      const local = fakeEngine('LOCAL', false);
      const cloud = fakeEngine('CLOUD', true);
      const progress = vi.fn();
      const router = new EngineRouter(local, cloud, fakeNetwork('FIELD'), { onModelProgress: progress });

      router.respond(input, callbacks(), new AbortController().signal);
      await vi.waitFor(() => expect(local.respond).toHaveBeenCalledTimes(1));

      expect(local.prepare).toHaveBeenCalledTimes(1);
      expect(progress).toHaveBeenCalledWith(0);
      expect(progress).toHaveBeenCalledWith(0.5);
      expect(progress).toHaveBeenLastCalledWith(null);
    });

    it('FIELD sem .gguf devolve MODEL_NOT_LOADED', async () => {
      const local = fakeEngine('LOCAL', false);
      local.prepare.mockResolvedValue(false);
      const cloud = fakeEngine('CLOUD', true);
      const router = new EngineRouter(local, cloud, fakeNetwork('FIELD'));
      const cb = callbacks();

      router.respond(input, cb, new AbortController().signal);
      await vi.waitFor(() => expect(cb.onError).toHaveBeenCalledWith('MODEL_NOT_LOADED'));

      expect(local.respond).not.toHaveBeenCalled();
    });

    it('DEGRADED responde pela cloud e pré-carrega a local em background', async () => {
      const local = fakeEngine('LOCAL', false);
      const cloud = fakeEngine('CLOUD', true);
      const router = new EngineRouter(local, cloud, fakeNetwork('DEGRADED'));

      router.respond(input, callbacks(), new AbortController().signal);

      expect(cloud.respond).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(local.prepare).toHaveBeenCalledTimes(1));
    });

    it('PROBING aguarda a resolução e age pelo modo resultante', async () => {
      const local = fakeEngine('LOCAL', true);
      const cloud = fakeEngine('CLOUD', true);
      const network = fakeNetwork('PROBING');
      const router = new EngineRouter(local, cloud, network);

      router.respond(input, callbacks(), new AbortController().signal);
      expect(cloud.respond).not.toHaveBeenCalled();
      expect(local.respond).not.toHaveBeenCalled();

      network.set('ONLINE');
      await vi.waitFor(() => expect(cloud.respond).toHaveBeenCalledTimes(1));
    });

    it(`PROBING sem resolução em ${PROBING_WAIT_MS}ms cai para a local (offline-first)`, async () => {
      vi.useFakeTimers();
      const local = fakeEngine('LOCAL', true);
      const cloud = fakeEngine('CLOUD', true);
      const router = new EngineRouter(local, cloud, fakeNetwork('PROBING'));

      router.respond(input, callbacks(), new AbortController().signal);
      await vi.advanceTimersByTimeAsync(PROBING_WAIT_MS + 1);

      expect(local.respond).toHaveBeenCalledTimes(1);
      expect(cloud.respond).not.toHaveBeenCalled();
    });
  });

  describe('fallback silencioso', () => {
    it.each(['TIMEOUT', 'LLM_UNAVAILABLE'] as const)(
      'cloud falha com %s antes do primeiro token e a local está pronta → local assume, sem erro na UI',
      async (error) => {
        const local = fakeEngine('LOCAL', true);
        const cloud = fakeEngine('CLOUD', true);
        const router = new EngineRouter(local, cloud, fakeNetwork('ONLINE'));
        const cb = callbacks();

        router.respond(input, cb, new AbortController().signal);
        cloud.captured!.onError(error);

        await vi.waitFor(() => expect(local.respond).toHaveBeenCalledTimes(1));
        expect(cb.onError).not.toHaveBeenCalled();
      }
    );

    it('cloud falha depois de já ter enviado tokens → entrega o parcial com o erro, sem trocar de motor', () => {
      const local = fakeEngine('LOCAL', true);
      const cloud = fakeEngine('CLOUD', true);
      const router = new EngineRouter(local, cloud, fakeNetwork('ONLINE'));
      const cb = callbacks();

      router.respond(input, cb, new AbortController().signal);
      cloud.captured!.onToken('parcial');
      cloud.captured!.onError('TIMEOUT');

      expect(cb.onToken).toHaveBeenCalledWith('parcial');
      expect(cb.onError).toHaveBeenCalledWith('TIMEOUT');
      expect(local.respond).not.toHaveBeenCalled();
    });

    it('cloud falha e a local não está pronta → erro chega à UI', () => {
      const local = fakeEngine('LOCAL', false);
      const cloud = fakeEngine('CLOUD', true);
      const router = new EngineRouter(local, cloud, fakeNetwork('ONLINE'));
      const cb = callbacks();

      router.respond(input, cb, new AbortController().signal);
      cloud.captured!.onError('TIMEOUT');

      expect(cb.onError).toHaveBeenCalledWith('TIMEOUT');
      expect(local.respond).not.toHaveBeenCalled();
    });

    it.each(['RATE_LIMITED', 'TOKEN_EXPIRED', 'ABORTED', 'UNKNOWN'] as const)(
      '%s nunca é fallback',
      (error) => {
        const local = fakeEngine('LOCAL', true);
        const cloud = fakeEngine('CLOUD', true);
        const router = new EngineRouter(local, cloud, fakeNetwork('ONLINE'));
        const cb = callbacks();

        router.respond(input, cb, new AbortController().signal);
        cloud.captured!.onError(error);

        expect(cb.onError).toHaveBeenCalledWith(error);
        expect(local.respond).not.toHaveBeenCalled();
      }
    );
  });

  describe('ciclo de vida do modelo local', () => {
    it('start() em FIELD pré-carrega a local', async () => {
      const local = fakeEngine('LOCAL', false);
      const router = new EngineRouter(local, fakeEngine('CLOUD', true), fakeNetwork('FIELD'));

      router.start();

      await vi.waitFor(() => expect(local.prepare).toHaveBeenCalledTimes(1));
      router.stop();
    });

    it(`ONLINE contínuo por ${RELEASE_AFTER_ONLINE_MS}ms descarrega a local`, async () => {
      vi.useFakeTimers();
      const local = fakeEngine('LOCAL', true);
      const network = fakeNetwork('FIELD');
      const router = new EngineRouter(local, fakeEngine('CLOUD', true), network);
      router.start();

      network.set('ONLINE');
      await vi.advanceTimersByTimeAsync(RELEASE_AFTER_ONLINE_MS - 1);
      expect(local.release).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2);
      expect(local.release).toHaveBeenCalledTimes(1);
      router.stop();
    });

    it('oscilação ONLINE → DEGRADED → ONLINE dentro da janela não descarrega', async () => {
      vi.useFakeTimers();
      const local = fakeEngine('LOCAL', true);
      const network = fakeNetwork('FIELD');
      const router = new EngineRouter(local, fakeEngine('CLOUD', true), network);
      router.start();

      network.set('ONLINE');
      await vi.advanceTimersByTimeAsync(RELEASE_AFTER_ONLINE_MS / 2);
      network.set('DEGRADED');
      await vi.advanceTimersByTimeAsync(RELEASE_AFTER_ONLINE_MS);

      expect(local.release).not.toHaveBeenCalled();
      router.stop();
    });

    it('mudança de modo durante uma resposta não a interrompe', () => {
      const local = fakeEngine('LOCAL', true);
      const cloud = fakeEngine('CLOUD', true);
      const network = fakeNetwork('ONLINE');
      const router = new EngineRouter(local, cloud, network);
      const cb = callbacks();
      const controller = new AbortController();

      router.respond(input, cb, controller.signal);
      network.set('FIELD');
      cloud.captured!.onToken('ainda respondendo');
      cloud.captured!.onDone({ kind: 'CLOUD', latencyMs: 10 });

      expect(controller.signal.aborted).toBe(false);
      expect(cb.onToken).toHaveBeenCalledWith('ainda respondendo');
      expect(cb.onDone).toHaveBeenCalled();
    });
  });
});
