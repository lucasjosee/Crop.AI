// backend/src/modules/chat/chat.service.ts
import { AGRONOMO_SYSTEM_PROMPT, FOTO_ANEXADA_PROMPT } from '../../config/llm';
import { env } from '../../config/env';
import { createLLMProvider, LLMProvider, StreamCallbacks } from './providers/llm.provider';
import { ChatStreamInput } from './chat.schema';
import { AppError } from '../../shared/errors';
import { S3DiagnosticImageLoader, type DiagnosticImageLoader } from '../../shared/diagnostic-image-loader';
import type { LLMImageInput, LLMUsage } from './providers/llm.provider';
import { usoLlmRepository, type UsoLlmRepository } from '../uso-llm/uso-llm.repository';

interface JwtUser {
  sub: string;
  role: string;
}

export const CHAT_STREAM_TIMEOUT_MS = 60_000;
export const CHAT_IMAGE_LOAD_TIMEOUT_MS = 5_000;

/** O que o serviço usa do logger da requisição (o `request.log` do Fastify). */
export interface ChatLogger {
  error(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
}

export interface ChatStreamContext {
  log: ChatLogger;
  /** Aborta quando o cliente desconecta. */
  signal?: AbortSignal;
}

export class ChatService {
  private provider: LLMProvider;
  private readonly timeoutMs: number;
  private readonly imageLoader: DiagnosticImageLoader;
  private readonly imageTimeoutMs: number;
  private readonly usoRepo: UsoLlmRepository;

  constructor(
    provider?: LLMProvider,
    opcoes: {
      timeoutMs?: number;
      imageLoader?: DiagnosticImageLoader;
      imageTimeoutMs?: number;
      usoRepo?: UsoLlmRepository;
    } = {}
  ) {
    this.provider = provider ?? createLLMProvider();
    this.timeoutMs = opcoes.timeoutMs ?? CHAT_STREAM_TIMEOUT_MS;
    this.imageLoader = opcoes.imageLoader ?? new S3DiagnosticImageLoader();
    this.imageTimeoutMs = opcoes.imageTimeoutMs ?? CHAT_IMAGE_LOAD_TIMEOUT_MS;
    this.usoRepo = opcoes.usoRepo ?? usoLlmRepository;
  }

  /**
   * Cota diária: roda antes de a resposta virar stream, para sair como 429
   * normal. Contagem e gravação não são atômicas, então requisições
   * simultâneas podem passar do teto por poucas unidades (aceito, ADR 0007).
   */
  async verificarCota(userId: string): Promise<void> {
    const usadas = await this.usoRepo.contarChatsDasUltimas24h(userId);
    if (usadas >= env.LLM_CHAT_DAILY_LIMIT) {
      throw new AppError(
        429,
        'DAILY_QUOTA_EXCEEDED',
        'O limite diário de conversas com o assistente online foi atingido.'
      );
    }
  }

  async stream(
    input: ChatStreamInput,
    user: JwtUser,
    callbacks: StreamCallbacks,
    contexto: ChatStreamContext
  ): Promise<void> {
    // A LLM perde a imagem, não a conversa: falha ao carregar segue sem foto.
    const imagem = await this.carregarImagem(input, contexto.log);
    if (contexto.signal?.aborted) {
      // O cliente saiu durante o carregamento: nem chega a chamar (e pagar) o provedor.
      contexto.log.info({ provedor: env.LLM_PROVIDER }, 'Conversa cancelada antes de chamar o provedor');
      throw new AppError(502, 'LLM_UNAVAILABLE', 'O serviço de IA está temporariamente indisponível.');
    }
    const systemPrompt = this.buildSystemPrompt(input, imagem !== undefined);

    // Um controlador próprio: cancela tanto pelo cliente quanto pelo teto.
    const controller = new AbortController();
    const aoCancelar = () => controller.abort();
    if (contexto.signal?.aborted) controller.abort();
    contexto.signal?.addEventListener('abort', aoCancelar, { once: true });

    let uso: LLMUsage | null = null;
    const callbacksComUso: StreamCallbacks = {
      onChunk: callbacks.onChunk,
      onDone: (u) => {
        uso = u;
        callbacks.onDone(u);
      },
    };

    let estourou = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const teto = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        estourou = true;
        controller.abort();
        reject(new AppError(504, 'LLM_TIMEOUT', 'A resposta da IA excedeu o tempo limite.'));
      }, this.timeoutMs);
    });
    teto.catch(() => {}); // evita rejeição não tratada se o provedor terminar antes

    try {
      await Promise.race([
        this.provider.stream(systemPrompt, input.history, input.message, callbacksComUso, {
          signal: controller.signal,
          imagem,
        }),
        teto,
      ]);
    } catch (error) {
      if (estourou) {
        contexto.log.error(
          { provedor: env.LLM_PROVIDER, modelo: env.LLM_MODEL_ID, timeoutMs: this.timeoutMs },
          'A conversa excedeu o teto de tempo e foi cancelada'
        );
        throw new AppError(504, 'LLM_TIMEOUT', 'A resposta da IA excedeu o tempo limite.');
      }
      if (contexto.signal?.aborted) {
        // O cliente saiu: não é falha do provedor.
        contexto.log.info(
          { provedor: env.LLM_PROVIDER, modelo: env.LLM_MODEL_ID },
          'Conversa cancelada pelo cliente'
        );
      } else {
        contexto.log.error(
          { err: error, provedor: env.LLM_PROVIDER, modelo: env.LLM_MODEL_ID },
          'O provedor de LLM falhou na conversa'
        );
      }
      throw new AppError(502, 'LLM_UNAVAILABLE', 'O serviço de IA está temporariamente indisponível.');
    } finally {
      if (timer) clearTimeout(timer);
      contexto.signal?.removeEventListener('abort', aoCancelar);
      // Sucesso, erro ou cancelamento: a chamada chegou ao provedor e conta na cota.
      await this.registrarUso(user.sub, uso, imagem !== undefined, contexto.log);
    }
  }

  private async registrarUso(
    userId: string,
    uso: LLMUsage | null,
    comImagem: boolean,
    log: ChatLogger
  ): Promise<void> {
    try {
      await this.usoRepo.registrar({
        userId,
        tipo: 'CHAT',
        provedor: env.LLM_PROVIDER,
        modelo: env.LLM_MODEL_ID,
        tokensEntrada: uso?.tokensEntrada ?? null,
        tokensSaida: uso?.tokensSaida ?? null,
        comImagem,
      });
    } catch (error) {
      log.error({ err: error, userId }, 'Não foi possível registrar o uso da LLM na conversa');
    }
  }

  private async carregarImagem(
    input: ChatStreamInput,
    log: ChatLogger
  ): Promise<LLMImageInput | undefined> {
    if (!input.image_s3_key) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.imageLoader.load(input.image_s3_key),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Tempo esgotado ao carregar a imagem do chat.')),
            this.imageTimeoutMs
          );
        }),
      ]);
    } catch (error) {
      log.error({ err: error, s3Key: input.image_s3_key }, 'A imagem do chat não carregou; a conversa segue sem ela');
      return undefined;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Prompt base + contexto do catálogo (pronto, do cliente) + achado do CV.
   * O contexto é idêntico ao que a SLM local recebe: grounding igual nos dois
   * motores é o ponto.
   */
  private buildSystemPrompt(input: ChatStreamInput, comImagem: boolean): string {
    const parts = [AGRONOMO_SYSTEM_PROMPT];
    if (input.catalog_context) {
      parts.push(`[Contexto do Catálogo]\n${input.catalog_context}`);
    }
    if (input.cv_result) {
      const confianca = Math.round(input.cv_result.confianca * 100);
      parts.push(
        `O modelo de visão local identificou ${input.cv_result.doenca_nome} com ${confianca}% de confiança.`
      );
    }
    if (comImagem) parts.push(FOTO_ANEXADA_PROMPT);
    return parts.join('\n\n');
  }
}
