import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import Toast from 'react-native-toast-message';
import { useAuthStore } from '../store/useAuthStore';
import { useNetworkStore } from '../store/useNetworkStore';
import { useSyncStore } from '../store/useSyncStore';
import { initDatabase } from '../db/sqlite';
import { theme } from '../config/theme';
import { Button } from '../components/Button';

const APP_BOOT_STARTED_AT = Date.now();

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  
  const { isAuthenticated, isLoading, loadStoredSession } = useAuthStore();
  const { initNetworkSensing } = useNetworkStore();
  const [dbReady, setDbReady] = useState(false);
  const [bootError, setBootError] = useState(false);
  const [bootAttempt, setBootAttempt] = useState(0);

  // 1. Inicialização do Banco de Dados, Sessões e Sensores no Boot
  useEffect(() => {
    async function setupApp() {
      try {
        setBootError(false);
        setDbReady(false);
        console.log('[RootLayout] Booting up App...');
        // Inicializar Banco de dados local (com fallback de web e seed)
        await initDatabase();
        setDbReady(true);

        // Inicializar Recuperação de Sessão local do usuário
        await loadStoredSession();

        // Inicializar Monitoramento de Sinal (Network Sensing)
        initNetworkSensing();
        console.info(`[Performance] App ready in ${Date.now() - APP_BOOT_STARTED_AT}ms.`);
      } catch (err) {
        console.error('[RootLayout] App boot failed.');
        setBootError(true);
      }
    }
    
    setupApp();
  }, [bootAttempt]);

  // 1b. Auto-sync Store & Forward na transição para ONLINE (volta para a sede)
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = useNetworkStore.subscribe((state, prev) => {
      if (state.connectionMode === 'ONLINE' && prev.connectionMode !== 'ONLINE') {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          console.log('[RootLayout] Conexão restabelecida — disparando sync automático...');
          useSyncStore.getState().syncNow();
        }, 2000);
      }
      if (state.connectionMode === 'FIELD' && debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    });

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribe();
    };
  }, []);

  // 2. Auth Guard - Redirecionador automático de rotas
  useEffect(() => {
    if (isLoading || !dbReady) return;

    // segments[0] retorna o grupo atual (ex: '(auth)' ou undefined/outra rota)
    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      // Se não autenticado e fora do fluxo de auth -> envia para Login
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      // Se autenticado e dentro do fluxo de auth -> envia para Home principal
      router.replace('/');
    }
  }, [isAuthenticated, isLoading, dbReady, segments]);

  // Se carregando configurações iniciais, exibe loader premium Dark
  if (bootError) {
    return (
      <View style={styles.loadingContainer} accessibilityRole="alert">
        <Text style={styles.bootErrorTitle}>Não foi possível iniciar com segurança</Text>
        <Text style={styles.bootErrorText}>
          Verifique o armazenamento do aparelho e tente novamente. Seus dados não foram substituídos.
        </Text>
        <Button
          title="Tentar novamente"
          onPress={() => setBootAttempt((attempt) => attempt + 1)}
          accessibilityHint="Tenta abrir novamente o banco local criptografado"
          style={styles.retryButton}
        />
      </View>
    );
  }

  if (isLoading || !dbReady) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.loadingText}>Carregando Crop.AI...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="camera" />
        <Stack.Screen name="chat" />
        <Stack.Screen name="(auth)/login" />
        <Stack.Screen name="(auth)/register" />
      </Stack>
      
      {/* Container global de Toasts */}
      <Toast />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: 'bold',
    marginTop: theme.spacing.md,
  },
  bootErrorTitle: {
    color: theme.colors.error,
    fontSize: theme.typography.fontSize.xl,
    fontWeight: 'bold',
    textAlign: 'center',
    paddingHorizontal: theme.spacing.lg,
  },
  bootErrorText: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.fontSize.md,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  retryButton: {
    marginTop: theme.spacing.lg,
    minWidth: 220,
  },
});
