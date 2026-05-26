import { FastifyInstance } from 'fastify';
import { authController } from './auth.controller';

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/register', authController.register);
  fastify.post('/login', authController.login);
  fastify.post('/refresh', authController.refresh);
  fastify.post('/logout', authController.logout);
}
export default authRoutes;
