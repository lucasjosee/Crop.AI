import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNetworkStore } from '../store/useNetworkStore';
import { theme } from '../config/theme';

export const ConnectionIndicator: React.FC = () => {
  const { connectionMode, forceCheck } = useNetworkStore();

  if (connectionMode === 'ONLINE') {
    return (
      <View
        style={[styles.container, styles.online]}
        accessibilityRole="text"
        accessibilityLabel="Conexão online"
      >
        <Ionicons name="cloud" size={16} color={theme.colors.primary} style={styles.icon} />
        <Text style={styles.text}>Modo Online</Text>
      </View>
    );
  }

  if (connectionMode === 'DEGRADED') {
    return (
      <Pressable
        onPress={forceCheck}
        style={[styles.container, styles.degraded]}
        accessibilityRole="button"
        accessibilityLabel="Conexão instável"
        accessibilityHint="Verifica a conexão novamente"
      >
        <Ionicons name="cloud" size={16} color={theme.colors.warning} style={styles.icon} />
        <Text style={styles.text}>Conexão Instável</Text>
      </Pressable>
    );
  }

  if (connectionMode === 'FIELD') {
    return (
      <Pressable
        onPress={forceCheck}
        style={[styles.container, styles.field]}
        accessibilityRole="button"
        accessibilityLabel="Modo campo offline"
        accessibilityHint="Verifica a conexão novamente"
      >
        <Ionicons name="cloud-offline" size={16} color={theme.colors.error} style={styles.icon} />
        <Text style={styles.text}>Modo Campo (Offline)</Text>
      </Pressable>
    );
  }

  return (
    <View
      style={[styles.container, styles.probing]}
      accessibilityRole="progressbar"
      accessibilityLabel="Verificando conexão"
    >
      <Ionicons name="cloud-outline" size={16} color={theme.colors.info} style={styles.icon} />
      <Text style={styles.text}>Verificando sinal...</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.round,
    alignSelf: 'center',
    marginVertical: theme.spacing.xs,
  },
  icon: {
    marginRight: theme.spacing.xs,
  },
  text: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  online: {
    backgroundColor: `${theme.colors.success}20`,
    borderWidth: 1,
    borderColor: theme.colors.success,
  },
  degraded: {
    backgroundColor: `${theme.colors.warning}20`,
    borderWidth: 1,
    borderColor: theme.colors.warning,
  },
  field: {
    backgroundColor: `${theme.colors.error}20`,
    borderWidth: 1,
    borderColor: theme.colors.error,
  },
  probing: {
    backgroundColor: `${theme.colors.info}20`,
    borderWidth: 1,
    borderColor: theme.colors.info,
  },
});
