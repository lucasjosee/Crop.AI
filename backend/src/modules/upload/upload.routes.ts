import { FastifyInstance } from 'fastify';
import { uploadController } from './upload.controller';
import { authenticate } from '../../plugins/authenticate';

export async function uploadRoutes(fastify: FastifyInstance) {
  fastify.post('/url', { preHandler: [authenticate] }, uploadController.createUrl);
}

export default uploadRoutes;
