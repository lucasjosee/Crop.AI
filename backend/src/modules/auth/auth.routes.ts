import { FastifyInstance } from 'fastify';
import { authController } from './auth.controller';
import { authenticate } from '../../plugins/authenticate';
import { RATE_LIMITS, routeRateLimit } from '../../config/rate-limit';

export async function authRoutes(fastify: FastifyInstance) {
  const config = routeRateLimit(RATE_LIMITS.auth);

  fastify.post('/register', { config }, authController.register);
  fastify.post('/login', { config }, authController.login);
  fastify.post('/refresh', { config }, authController.refresh);
  fastify.post('/logout', { config, preHandler: [authenticate] }, authController.logout);
}
export default authRoutes;
