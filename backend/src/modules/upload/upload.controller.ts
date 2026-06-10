import { FastifyRequest, FastifyReply } from 'fastify';
import { uploadUrlSchema } from './upload.schema';
import { uploadService } from './upload.service';

export const uploadController = {
  async createUrl(request: FastifyRequest, reply: FastifyReply) {
    const body = uploadUrlSchema.parse(request.body);
    const user = request.user as { sub: string };
    const result = await uploadService.createUploadUrl(user.sub, body.content_type);
    return reply.code(200).send(result);
  },
};
