import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { RATE_LIMITS, routeRateLimit } from '../../config/rate-limit';
import { crossValidationController } from './cross-validation.controller';

export async function crossValidationRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/cross-validate',
    { config: routeRateLimit(RATE_LIMITS.crossValidation), preHandler: [authenticate] },
    crossValidationController.crossValidate
  );
}

export default crossValidationRoutes;
