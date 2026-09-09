import { FastifyRequest } from 'fastify';

/**
 * Limites por rota, em requisições por minuto.
 *
 * Precisam ser declarados na definição de cada rota (`config.rateLimit`), e não
 * no `app.register()` do módulo: ali eles viram opção do plugin, que o
 * @fastify/rate-limit nunca lê, e a rota acaba rodando no limite global.
 */
export const RATE_LIMITS = {
  auth: 10,
  chat: 20,
  sync: 30,
  catalog: 60,
  crossValidation: 20,
} as const;

/**
 * Permite desligar a limitação sem alterar código — útil em teste de carga,
 * ambiente interno e nas suítes de integração, que exercitam num minuto muito
 * mais requisições do que um produtor real faria.
 */
export function rateLimitEnabled(): boolean {
  return process.env.RATE_LIMIT_ENABLED !== 'false';
}

const NO_LIMIT = Number.MAX_SAFE_INTEGER;

/**
 * `max` é função porque é avaliada a cada requisição: assim a chave de
 * desligamento vale em tempo de execução, e não só no momento do registro.
 */
export function routeRateLimit(max: number) {
  return { rateLimit: { max: () => (rateLimitEnabled() ? max : NO_LIMIT), timeWindow: '1 minute' } };
}

/**
 * Chaveia o balde pelo usuário autenticado, caindo para o IP quando não há
 * token válido.
 *
 * O plugin roda em `onRequest`, antes do `preHandler` que popula
 * `request.user`, então a verificação do token precisa acontecer aqui — do
 * contrário a chave por usuário nunca sairia do papel e o limite continuaria
 * sendo por IP, que é a dimensão errada: atrás de um proxy toda a base divide
 * um balde, e sem proxy um aparelho em rede móvel troca de IP e escapa do teto.
 */
export async function rateLimitKeyGenerator(request: FastifyRequest): Promise<string> {
  const alreadyVerified = (request as { user?: { sub?: string } }).user?.sub;
  if (alreadyVerified) return `user:${alreadyVerified}`;

  try {
    const payload = await request.jwtVerify<{ sub: string }>();
    return `user:${payload.sub}`;
  } catch {
    return `ip:${request.ip}`;
  }
}
