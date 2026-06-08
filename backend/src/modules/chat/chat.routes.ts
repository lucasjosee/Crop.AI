// backend/src/modules/chat/chat.routes.ts
import { FastifyInstance } from 'fastify';
import { chatController } from './chat.controller';
import { authenticate } from '../../plugins/authenticate';

export async function chatRoutes(fastify: FastifyInstance) {
  fastify.post('/stream', { preHandler: [authenticate] }, chatController.stream);
}

export default chatRoutes;
