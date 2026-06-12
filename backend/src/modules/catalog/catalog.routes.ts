import { FastifyInstance } from 'fastify';
import { catalogController } from './catalog.controller';
import { authenticate } from '../../plugins/authenticate';

export async function catalogRoutes(fastify: FastifyInstance) {
  fastify.get('/sync', { preHandler: [authenticate] }, catalogController.sync);
}

export default catalogRoutes;
