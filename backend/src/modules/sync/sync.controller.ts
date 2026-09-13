import { FastifyRequest, FastifyReply } from 'fastify';
import {
  syncDiagnosticsSchema,
  syncFeedbackSchema,
  syncConversationsSchema,
} from './sync.schema';
import { syncService } from './sync.service';

export const syncController = {
  async diagnostics(request: FastifyRequest, reply: FastifyReply) {
    const body = syncDiagnosticsSchema.parse(request.body);
    const user = request.user as { sub: string };
    const result = await syncService.syncDiagnostics(user.sub, body);
    return reply.code(200).send(result);
  },

  async feedback(request: FastifyRequest, reply: FastifyReply) {
    const body = syncFeedbackSchema.parse(request.body);
    const user = request.user as { sub: string };
    const result = await syncService.syncFeedback(user.sub, body);
    return reply.code(202).send(result);
  },

  async conversations(request: FastifyRequest, reply: FastifyReply) {
    const body = syncConversationsSchema.parse(request.body);
    const user = request.user as { sub: string };
    const result = await syncService.syncConversations(user.sub, body);
    return reply.code(200).send(result);
  },
};
