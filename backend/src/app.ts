import Fastify, { FastifyError } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import { env } from './config/env';
import { AppError } from './shared/errors';
import authenticatePlugin, { authenticate } from './plugins/authenticate';
import authRoutes from './modules/auth/auth.routes';
import chatRoutes from './modules/chat/chat.routes';
import uploadRoutes from './modules/upload/upload.routes';
import syncRoutes from './modules/sync/sync.routes';
import catalogRoutes from './modules/catalog/catalog.routes';
import crossValidationRoutes from './modules/diagnosis/cross-validation.routes';
import { ALLOWED_ORIGINS } from './config/cors';
import { rateLimitEnabled, rateLimitKeyGenerator } from './config/rate-limit';

export const app = Fastify({
  logger: {
    level: env.NODE_ENV === 'development' ? 'debug' : 'info',
    transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    redact: {
      // O wildcard `*` do pino casa exatamente um nível: '*.access_token'
      // não cobre o segredo no topo nem o aninhado em dois níveis. Como não há
      // wildcard recursivo, cada profundidade real precisa ser listada.
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers.set-cookie',
        'access_token',
        'refresh_token',
        'password',
        'apiKey',
        '*.access_token',
        '*.refresh_token',
        '*.password',
        '*.apiKey',
        '*.*.access_token',
        '*.*.refresh_token',
        '*.*.password',
        '*.*.apiKey',
      ],
      censor: '[REDACTED]',
    },
  },
});

// Register CORS (allow Expo web dev server)
app.register(fastifyCors, {
  origin: ALLOWED_ORIGINS,
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
  max: () => (rateLimitEnabled() ? 60 : Number.MAX_SAFE_INTEGER),
  timeWindow: '1 minute',
  keyGenerator: rateLimitKeyGenerator,
  errorResponseBuilder: (request, context) => {
    // Sem `statusCode` aqui, o objeto lançado chega ao setErrorHandler sem
    // status e cai no 500 genérico em vez de virar 429.
    return {
      statusCode: 429,
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
});

// Register Chat Routes
app.register(chatRoutes, {
  prefix: '/api/v1/chat',
});

// Register Upload Routes
app.register(uploadRoutes, { prefix: '/api/v1/upload' });

// Register Sync Routes
app.register(syncRoutes, {
  prefix: '/api/v1/sync',
});

// Register Catalog Routes
app.register(catalogRoutes, {
  prefix: '/api/v1/catalog',
});

app.register(crossValidationRoutes, {
  prefix: '/api/v1/diagnosis',
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

  // Mensagem e stack são necessárias para localizar a falha; o bloco `redact`
  // acima é quem protege os segredos, não a supressão do erro.
  request.log.error(
    { err: error, errorCode: (error as { code?: string }).code },
    'Unhandled request error'
  );
  return reply.status(500).send({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Erro interno do servidor.',
      details: [],
    },
  });
});
