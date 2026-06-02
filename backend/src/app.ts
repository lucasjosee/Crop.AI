import Fastify, { FastifyError } from 'fastify';
import fastifyCors from '@fastify/cors';
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

// Register CORS (allow Expo web dev server)
app.register(fastifyCors, {
  origin: ['http://localhost:8081', 'http://localhost:19006', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
});

// Register JWT
app.register(fastifyJwt, {
  secret: env.JWT_SECRET,
  sign: { expiresIn: '15m' },
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
app.setErrorHandler((error: FastifyError | AppError | Error, request, reply) => {
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
    const zodError = error as Error & { issues?: Array<{ path: string[]; message: string }> };
    const details =
      zodError.issues?.map((issue) => ({
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

  const fastifyError = error as FastifyError;

  if (fastifyError.validation) {
    return reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: fastifyError.message,
        details: fastifyError.validation,
      },
    });
  }

  if (fastifyError.statusCode === 429) {
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
