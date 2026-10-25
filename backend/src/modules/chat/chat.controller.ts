// backend/src/modules/chat/chat.controller.ts
import { FastifyRequest, FastifyReply } from 'fastify';
import { ChatService } from './chat.service';
import { chatStreamInputSchema } from './chat.schema';
import { AppError } from '../../shared/errors';
import { resolveAllowedOrigin } from '../../config/cors';

const chatService = new ChatService();

export const chatController = {
  stream: async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = chatStreamInputSchema.parse(request.body);
    const user = request.user as { sub: string; role: string };

    // Hijack the response to write SSE manually
    reply.hijack();

    // Hijacking bypasses the Fastify CORS plugin's onSend hook, so we must
    // set the CORS headers manually here for the streaming response.
    const allowedOrigin = resolveAllowedOrigin(request.headers.origin);
    const corsHeaders: Record<string, string> = allowedOrigin
      ? {
          'Access-Control-Allow-Origin': allowedOrigin,
          'Access-Control-Allow-Credentials': 'true',
          Vary: 'Origin',
        }
      : {};

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...corsHeaders,
    });

    let aborted = false;
    // A desconexão vem do close da resposta, e só vale se ela ainda não
    // terminou. O close do IncomingMessage (request.raw) não serve: no Node >= 16
    // ele sai quando o corpo termina de ser lido, com o cliente conectado, e
    // descartava a resposta inteira sem nem fechar o stream.
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) aborted = true;
    });

    let tokensUsed = 0;

    try {
      await chatService.stream(parsed, user, {
        onChunk: async (text: string) => {
          if (aborted) return;
          reply.raw.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
        },
        onDone: (tokens: number) => {
          tokensUsed = tokens;
        },
      });

      if (!aborted) {
        reply.raw.end(
          `data: ${JSON.stringify({ done: true, tokens_used: tokensUsed })}\n\n`
        );
      }
    } catch (error) {
      if (!aborted) {
        const code = error instanceof AppError ? error.code : 'LLM_UNAVAILABLE';
        const status = error instanceof AppError ? error.statusCode : 502;
        reply.raw.write(
          `data: ${JSON.stringify({ error: { code, status } })}\n\n`
        );
        reply.raw.end();
      }
    }
  },
};
