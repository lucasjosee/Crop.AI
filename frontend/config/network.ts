export const NETWORK_CONFIG = {
  HEALTH_CHECK_URL: '/api/v1/health',
  TIMEOUT_MS: 2000,
  PROBE_INTERVAL_MS: 15000,       // Intervalo de ping quando online (15s)
  DEBOUNCE_FIELD_MS: 3000,         // Latência antes de confirmar queda (3s)
  MAX_CONSECUTIVE_FAILURES: 2,     // Número de falhas no ping para ir para FIELD
  BACKOFF_LIMITS: {
    MIN_SECONDS: 30,               // Primeiro retry após queda
    MAX_SECONDS: 300               // Limite de backoff (5 minutos)
  }
};
export type ConnectionMode = 'PROBING' | 'ONLINE' | 'DEGRADED' | 'FIELD';
export default NETWORK_CONFIG;
