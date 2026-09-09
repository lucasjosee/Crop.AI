// backend/src/modules/chat/chat.routes.ts
import { FastifyInstance } from 'fastify';
import { chatController } from './chat.controller';
import { authenticate } from '../../plugins/authenticate';
import { RATE_LIMITS, routeRateLimit } from '../../config/rate-limit';

export async function chatRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/stream',
    { config: routeRateLimit(RATE_LIMITS.chat), preHandler: [authenticate] },
    chatController.stream
  );
}

export default chatRoutes;
