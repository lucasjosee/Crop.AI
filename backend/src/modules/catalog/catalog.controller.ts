import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getCatalogDelta } from './catalog.service';

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const catalogController = {
  async sync(request: FastifyRequest, reply: FastifyReply) {
    const { cursor, limit } = querySchema.parse(request.query);
    const rawEtag = request.headers['if-none-match'] as string | undefined;
    const clientEtag = rawEtag?.replace(/^W\//, '').replace(/"/g, '');

    const result = await getCatalogDelta(clientEtag, cursor, limit);

    if (result.notModified) {
      return reply.code(304).header('etag', `"${result.etag}"`).send();
    }

    return reply.header('etag', `"${result.etag}"`).send({
      catalog_version_hash: result.etag,
      next_cursor: result.next_cursor,
      has_more: result.has_more,
      updates: result.updates,
    });
  },
};
