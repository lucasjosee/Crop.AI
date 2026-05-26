import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useNetworkStore } from '../store/useNetworkStore';
import { theme } from '../config/theme';

export const ConnectionIndicator: React.FC = () => {
  const { connectionMode, forceCheck } = useNetworkStore();

  if (connectionMode === 'ONLINE') {
    return (
      <View style={[styles.container, styles.online]}>
        <View style={[styles.dot, styles.dotOnline]} />
        <Text style={styles.text}>Modo Online</Text>
      </View>
    );
  }

  if (connectionMode === 'DEGRADED') {
    return (
      <Pressable onPress={forceCheck} style={[styles.container, styles.degraded]}>
        <View style={[styles.dot, styles.dotDegraded]} />
        <Text style={styles.text}>Conexão Instável</Text>
      </Pressable>
    );
  }

  if (connectionMode === 'FIELD') {
    return (
      <Pressable onPress={forceCheck} style={[styles.container, styles.field]}>
        <View style={[styles.dot, styles.dotField]} />
        <Text style={styles.text}>Modo Campo (Offline)</Text>
      </Pressable>
    );
  }

  return (
    <View style={[styles.container, styles.probing]}>
      <View style={[styles.dot, styles.dotProbing]} />
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
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
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
  dotOnline: {
    backgroundColor: theme.colors.success,
  },
  degraded: {
    backgroundColor: `${theme.colors.warning}20`,
    borderWidth: 1,
    borderColor: theme.colors.warning,
  },
  dotDegraded: {
    backgroundColor: theme.colors.warning,
  },
  field: {
    backgroundColor: `${theme.colors.error}20`,
    borderWidth: 1,
    borderColor: theme.colors.error,
  },
  dotField: {
    backgroundColor: theme.colors.error,
  },
  probing: {
    backgroundColor: `${theme.colors.info}20`,
    borderWidth: 1,
    borderColor: theme.colors.info,
  },
  dotProbing: {
    backgroundColor: theme.colors.info,
  },
});
