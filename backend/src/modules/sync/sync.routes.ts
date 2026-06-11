import { FastifyInstance } from 'fastify';
import { syncController } from './sync.controller';
import { authenticate } from '../../plugins/authenticate';

export async function syncRoutes(fastify: FastifyInstance) {
  fastify.post('/diagnostics', { preHandler: [authenticate] }, syncController.diagnostics);
  fastify.post('/feedback', { preHandler: [authenticate] }, syncController.feedback);
  fastify.post('/slm-logs', { preHandler: [authenticate] }, syncController.slmLogs);
}

export default syncRoutes;
