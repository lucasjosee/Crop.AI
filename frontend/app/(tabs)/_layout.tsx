import React from 'react';
import { ColorValue, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../config/theme';

type NomeDoIcone = React.ComponentProps<typeof Ionicons>['name'];

function icone(inativo: NomeDoIcone, ativo: NomeDoIcone) {
  return function IconeDaAba({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) {
    return <Ionicons name={focused ? ativo : inativo} size={size} color={color} />;
  };
}

// O botão ignora o onPress que a barra entrega: tocar aqui não troca de aba,
// empurra a câmera por cima de tudo. Cabe inteiro dentro da barra — no
// Android, a parte de um botão que saltasse para fora dela não receberia toque.
function BotaoAnalisar() {
  const router = useRouter();
  return (
    <View style={styles.analisarCaixa}>
      <TouchableOpacity
        style={styles.analisar}
        onPress={() => router.push('/camera')}
        accessibilityRole="button"
        accessibilityLabel="Analisar uma folha com a câmera"
      >
        <Ionicons name="camera" size={22} color={theme.colors.surface} />
        <Text style={styles.analisarTexto}>Analisar</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function LayoutDasAbas() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        tabBarHideOnKeyboard: true,
        sceneStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Início', tabBarIcon: icone('home-outline', 'home') }} />
      <Tabs.Screen
        name="chat"
        options={{ title: 'Conversas', tabBarIcon: icone('chatbubbles-outline', 'chatbubbles') }}
      />
      <Tabs.Screen name="analisar" options={{ title: 'Analisar', tabBarButton: () => <BotaoAnalisar /> }} />
      <Tabs.Screen name="mapa" options={{ title: 'Mapa', tabBarIcon: icone('map-outline', 'map') }} />
      <Tabs.Screen name="catalogo" options={{ title: 'Catálogo', tabBarIcon: icone('book-outline', 'book') }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  analisarCaixa: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  analisar: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  analisarTexto: {
    color: theme.colors.surface,
    fontSize: theme.typography.fontSize.xxs,
    fontWeight: 'bold',
  },
});
