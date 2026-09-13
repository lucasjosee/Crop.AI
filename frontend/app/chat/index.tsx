// frontend/app/chat/index.tsx
// Ponto de entrada de /chat: cria uma conversa livre e redireciona para ela.
// Conversa que nasce de uma foto não passa por aqui — a câmera cria a sessão
// e a primeira mensagem ela mesma.
import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { createSession } from '../../lib/chatRepository';
import { theme } from '../../config/theme';

export default function NewChatScreen() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await createSession({ title: 'Nova conversa' });
      if (!cancelled) router.replace(`/chat/${session.id}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
