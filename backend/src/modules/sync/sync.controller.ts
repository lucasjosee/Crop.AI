import { FastifyRequest, FastifyReply } from 'fastify';
import { syncDiagnosticsSchema, syncFeedbackSchema, syncSlmLogsSchema } from './sync.schema';
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

  async slmLogs(request: FastifyRequest, reply: FastifyReply) {
    const body = syncSlmLogsSchema.parse(request.body);
    const user = request.user as { sub: string };
    const result = await syncService.syncSlmLogs(user.sub, body);
    return reply.code(202).send(result);
  },
};
