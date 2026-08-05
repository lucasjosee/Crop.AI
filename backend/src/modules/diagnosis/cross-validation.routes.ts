import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/authenticate';
import { crossValidationController } from './cross-validation.controller';

export async function crossValidationRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/cross-validate',
    { preHandler: [authenticate] },
    crossValidationController.crossValidate
  );
}

export default crossValidationRoutes;
