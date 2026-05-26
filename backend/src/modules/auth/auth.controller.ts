import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthService } from './auth.service';
import {
  registerInputSchema,
  loginInputSchema,
  refreshInputSchema,
  logoutInputSchema,
} from './auth.schema';

const authService = new AuthService();

export class AuthController {
  async register(request: FastifyRequest, reply: FastifyReply) {
    const parsed = registerInputSchema.parse(request.body);
    const result = await authService.register(parsed);
    return reply.status(201).send({ user: result });
  }

  async login(request: FastifyRequest, reply: FastifyReply) {
    const parsed = loginInputSchema.parse(request.body);
    const result = await authService.login(parsed, (payload) =>
      request.server.jwt.sign(payload)
    );
    return reply.status(200).send(result);
  }

  async refresh(request: FastifyRequest, reply: FastifyReply) {
    const parsed = refreshInputSchema.parse(request.body);
    const result = await authService.refresh(parsed.refresh_token, (payload) =>
      request.server.jwt.sign(payload)
    );
    return reply.status(200).send(result);
  }

  async logout(request: FastifyRequest, reply: FastifyReply) {
    const parsed = logoutInputSchema.parse(request.body);
    const result = await authService.logout(parsed.refresh_token);
    return reply.status(200).send(result);
  }
}
export const authController = new AuthController();
