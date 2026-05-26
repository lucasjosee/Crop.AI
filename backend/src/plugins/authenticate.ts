import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { UnauthorizedError } from '../shared/errors';

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err: any) {
    const isExpired = err.message?.toLowerCase().includes('expired') || err.code === 'FAST_JWT_EXPIRED';
    throw new UnauthorizedError(
      isExpired ? 'O Access Token expirou. Por favor, renove seu token.' : 'Token inválido ou ausente.',
      isExpired ? 'TOKEN_EXPIRED' : 'INVALID_CREDENTIALS'
    );
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: typeof authenticate;
  }
}

export default fp(async function (fastify: FastifyInstance) {
  fastify.decorate('authenticate', authenticate);
});
