// Allowed CORS origins, shared between the Fastify CORS plugin (app.ts)
// and the SSE chat controller (which hijacks the reply and must set the
// Access-Control-Allow-Origin header manually).
export const ALLOWED_ORIGINS = [
  'http://localhost:8081',
  'http://localhost:19006',
  'http://localhost:3000',
];

// Resolve the Access-Control-Allow-Origin value for a given request origin.
// Returns the echoed origin if allowed, otherwise null.
export function resolveAllowedOrigin(origin?: string): string | null {
  if (!origin) return null;
  return ALLOWED_ORIGINS.includes(origin) ? origin : null;
}
