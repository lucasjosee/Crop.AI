import type { FastifyReply, FastifyRequest } from 'fastify';
import { crossValidationInputSchema } from './cross-validation.schema';
import { crossValidationService } from './cross-validation.service';

export const crossValidationController = {
  async crossValidate(request: FastifyRequest, reply: FastifyReply) {
    // O setErrorHandler de app.ts já converte ZodError em 400/VALIDATION_ERROR
    // com o mesmo formato de details — é o padrão dos outros cinco controllers.
    const input = crossValidationInputSchema.parse(request.body);
    const user = request.user as { sub: string };
    const result = await crossValidationService.crossValidate(user.sub, input);
    return reply.code(200).send(result);
  },
};
