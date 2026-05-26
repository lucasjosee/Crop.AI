import { create } from 'zustand';
import NetInfo from '@react-native-community/netinfo';
import { api } from '../lib/api';
import { NETWORK_CONFIG, ConnectionMode } from '../config/network';

interface NetworkState {
  connectionMode: ConnectionMode;
  consecutiveFailures: number;
  backoffSeconds: number;
  initNetworkSensing: () => void;
  forceCheck: () => Promise<void>;
  checkConnection: () => Promise<void>;
}

export const useNetworkStore = create<NetworkState>((set, get) => {
  let probeTimer: any = null;
  let debounceFieldTimer: any = null;
  let unsubscribeNetInfo: (() => void) | null = null;

  return {
    connectionMode: 'PROBING',
    consecutiveFailures: 0,
    backoffSeconds: NETWORK_CONFIG.BACKOFF_LIMITS.MIN_SECONDS,

    initNetworkSensing: () => {
      console.log('[NetworkSensing] Initializing NetInfo listener...');
      
      // 1. Desinscrever listener anterior se houver
      if (unsubscribeNetInfo) {
        unsubscribeNetInfo();
        unsubscribeNetInfo = null;
      }

      // 2. Assinar as mudanças imediatas da interface de rede
      unsubscribeNetInfo = NetInfo.addEventListener((state) => {
        console.log(`[NetworkSensing] NetInfo event: type=${state.type}, isConnected=${state.isConnected}`);
        
        if (state.isConnected === false) {
          // Queda física detectada: corta imediatamente para FIELD sem aguardar timeouts
          if (debounceFieldTimer) clearTimeout(debounceFieldTimer);
          if (probeTimer) clearTimeout(probeTimer);
          
          set({ 
            connectionMode: 'FIELD', 
            consecutiveFailures: NETWORK_CONFIG.MAX_CONSECUTIVE_FAILURES,
            backoffSeconds: NETWORK_CONFIG.BACKOFF_LIMITS.MIN_SECONDS
          });
          
          // Agenda o primeiro probe com o tempo mínimo
          probeTimer = setTimeout(() => get().checkConnection(), NETWORK_CONFIG.BACKOFF_LIMITS.MIN_SECONDS * 1000);
        } else {
          // Restabelecimento físico: força probe imediato para tentar voltar online
          if (debounceFieldTimer) clearTimeout(debounceFieldTimer);
          set({ 
            consecutiveFailures: 0,
            backoffSeconds: NETWORK_CONFIG.BACKOFF_LIMITS.MIN_SECONDS 
          });
          get().checkConnection();
        }
      });

      // Disparar o primeiro probe imediato ao carregar o app
      get().checkConnection();
    },

    forceCheck: async () => {
      console.log('[NetworkSensing] Manual connection check triggered by user.');
      if (debounceFieldTimer) clearTimeout(debounceFieldTimer);
      set({ 
        backoffSeconds: NETWORK_CONFIG.BACKOFF_LIMITS.MIN_SECONDS, 
        consecutiveFailures: 0 
      });
      await get().checkConnection();
    },

    checkConnection: async () => {
      if (probeTimer) clearTimeout(probeTimer);

      const startTime = Date.now();
      let success = false;
      let latency = 0;

      try {
        // AbortController para forçar o threshold de timeout de 2000ms do ping
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), NETWORK_CONFIG.TIMEOUT_MS);

        const response = await api.get(NETWORK_CONFIG.HEALTH_CHECK_URL, {
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        
        if (response.status === 200 && response.data?.status === 'ok') {
          success = true;
          latency = Date.now() - startTime;
        }
      } catch (err) {
        // Silenciar erros de log normais ao perder conexão em campo
        console.log('[NetworkSensing] Health Check failed.');
      }

      if (success) {
        // Limpa os medidores de falha
        set({ 
          consecutiveFailures: 0, 
          backoffSeconds: NETWORK_CONFIG.BACKOFF_LIMITS.MIN_SECONDS 
        });

        // Transiciona baseado na latência da resposta
        if (latency > 1000) {
          set({ connectionMode: 'DEGRADED' });
          console.log(`[NetworkSensing] Mode: DEGRADED (Latency: ${latency}ms)`);
        } else {
          set({ connectionMode: 'ONLINE' });
          console.log(`[NetworkSensing] Mode: ONLINE (Latency: ${latency}ms)`);
        }

        // Mantém a rotina estável a cada 15 segundos
        probeTimer = setTimeout(() => get().checkConnection(), NETWORK_CONFIG.PROBE_INTERVAL_MS);
      } else {
        const currentFailures = get().consecutiveFailures;
        const newFailures = currentFailures + 1;
        set({ consecutiveFailures: newFailures });

        // Se falhar consecutivamente pela quantidade definida, transiciona para FIELD
        if (newFailures >= NETWORK_CONFIG.MAX_CONSECUTIVE_FAILURES) {
          if (get().connectionMode !== 'FIELD') {
            if (!debounceFieldTimer) {
              debounceFieldTimer = setTimeout(() => {
                set({ connectionMode: 'FIELD' });
                console.log('[NetworkSensing] Transitioning to FIELD (Offline)');
                debounceFieldTimer = null;
              }, NETWORK_CONFIG.DEBOUNCE_FIELD_MS);
            }
          }

          // Aplica retry com backoff exponencial no modo campo para economizar bateria
          const currentBackoff = get().backoffSeconds;
          const newBackoff = Math.min(
            currentBackoff * 2, 
            NETWORK_CONFIG.BACKOFF_LIMITS.MAX_SECONDS
          );
          set({ backoffSeconds: newBackoff });

          console.log(`[NetworkSensing] Signal lost. Next probe retry in ${currentBackoff}s.`);
          probeTimer = setTimeout(() => get().checkConnection(), currentBackoff * 1000);
        } else {
          // Na primeira falha isolada, tenta novamente de forma imediata (após 1s) para evitar falso negativo
          console.log(`[NetworkSensing] Probe failure (${newFailures}/${NETWORK_CONFIG.MAX_CONSECUTIVE_FAILURES}). Quick retry...`);
          probeTimer = setTimeout(() => get().checkConnection(), 1000);
        }
      }
    }
  };
});
