import type { FastifyReply, FastifyRequest } from 'fastify';
import { crossValidationInputSchema } from './cross-validation.schema';
import { crossValidationService } from './cross-validation.service';
import { ValidationError } from '../../shared/errors';

export const crossValidationController = {
  async crossValidate(request: FastifyRequest, reply: FastifyReply) {
    const parsed = crossValidationInputSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(
        'Falha na validação dos campos.',
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }))
      );
    }
    const user = request.user as { sub: string };
    const result = await crossValidationService.crossValidate(user.sub, parsed.data);
    return reply.code(200).send(result);
  },
};
