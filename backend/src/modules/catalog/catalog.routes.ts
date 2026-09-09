import { FastifyInstance } from 'fastify';
import { catalogController } from './catalog.controller';
import { authenticate } from '../../plugins/authenticate';
import { RATE_LIMITS, routeRateLimit } from '../../config/rate-limit';

export async function catalogRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/sync',
    { config: routeRateLimit(RATE_LIMITS.catalog), preHandler: [authenticate] },
    catalogController.sync
  );
}

export default catalogRoutes;
