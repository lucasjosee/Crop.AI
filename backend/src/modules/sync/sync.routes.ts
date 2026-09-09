import { FastifyInstance } from 'fastify';
import { syncController } from './sync.controller';
import { authenticate } from '../../plugins/authenticate';
import { RATE_LIMITS, routeRateLimit } from '../../config/rate-limit';

export async function syncRoutes(fastify: FastifyInstance) {
  const config = routeRateLimit(RATE_LIMITS.sync);

  fastify.post('/diagnostics', { config, preHandler: [authenticate] }, syncController.diagnostics);
  fastify.post('/feedback', { config, preHandler: [authenticate] }, syncController.feedback);
  fastify.post('/slm-logs', { config, preHandler: [authenticate] }, syncController.slmLogs);
}

export default syncRoutes;
