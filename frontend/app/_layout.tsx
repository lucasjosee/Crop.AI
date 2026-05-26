import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import Toast from 'react-native-toast-message';
import { useAuthStore } from '../store/useAuthStore';
import { useNetworkStore } from '../store/useNetworkStore';
import { initDatabase } from '../db/sqlite';
import { theme } from '../config/theme';

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  
  const { isAuthenticated, isLoading, loadStoredSession } = useAuthStore();
  const { initNetworkSensing } = useNetworkStore();
  const [dbReady, setDbReady] = useState(false);

  // 1. Inicialização do Banco de Dados, Sessões e Sensores no Boot
  useEffect(() => {
    async function setupApp() {
      try {
        console.log('[RootLayout] Booting up App...');
        // Inicializar Banco de dados local (com fallback de web e seed)
        await initDatabase();
        setDbReady(true);

        // Inicializar Recuperação de Sessão local do usuário
        await loadStoredSession();

        // Inicializar Monitoramento de Sinal (Network Sensing)
        initNetworkSensing();
      } catch (err) {
        console.error('[RootLayout] Failed to boot app:', err);
        setDbReady(true); // Evita trava eterna da interface
      }
    }
    
    setupApp();
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
        }}
      >
        <Stack.Screen name="index" />
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
});
