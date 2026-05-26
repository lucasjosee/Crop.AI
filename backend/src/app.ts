import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import { env } from './config/env';
import { AppError } from './shared/errors';
import authenticatePlugin, { authenticate } from './plugins/authenticate';
import authRoutes from './modules/auth/auth.routes';

export const app = Fastify({
  logger: {
    level: env.NODE_ENV === 'development' ? 'debug' : 'info',
    transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
  },
});

// Register JWT
app.register(fastifyJwt, {
  secret: env.JWT_SECRET,
});

// Register Rate Limiting
app.register(fastifyRateLimit, {
  global: true,
  max: 60,
  timeWindow: '1 minute',
  errorResponseBuilder: (request, context) => {
    return {
      error: {
        code: 'RATE_LIMITED',
        message: 'Limite de requisições excedido.',
        details: [
          {
            retryAfter: context.after,
          },
        ],
      },
    };
  },
});

// Register Auth Decorator Plugin
app.register(authenticatePlugin);

// Register Auth Routes
app.register(authRoutes, {
  prefix: '/api/v1/auth',
  config: {
    rateLimit: {
      max: 10,
      timeWindow: '1 minute',
    },
  },
});

// Health Check Route
app.get('/api/v1/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Protected Hello World Route for testing
app.get('/api/v1/protected', { preHandler: [authenticate] }, async (request, reply) => {
  return { message: 'Protected resource accessed successfully', user: request.user };
});

// Global Error Handler
app.setErrorHandler((error, request, reply) => {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
  }

  if (error.name === 'ZodError') {
    const details =
      (error as any).issues?.map((issue: any) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })) || [];
    return reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Falha na validação dos campos.',
        details,
      },
    });
  }

  if (error.validation) {
    return reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: error.validation,
      },
    });
  }

  if (error.statusCode === 429) {
    return reply.status(429).send({
      error: {
        code: 'RATE_LIMITED',
        message: 'Limite de requisições excedido. Por favor, tente novamente mais tarde.',
        details: [],
      },
    });
  }

  request.log.error(error);
  return reply.status(500).send({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Erro interno do servidor.',
      details: [],
    },
  });
});
