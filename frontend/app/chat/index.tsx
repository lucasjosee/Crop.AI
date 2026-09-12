// frontend/app/chat/index.tsx
// Ponto de entrada de /chat: cria uma sessão e redireciona para ela. Se a
// câmera deixou um diagnóstico no diagnosticContext, a sessão nasce apontando
// para ele — é assim que o contexto do catálogo é construído por doenca_id.
import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { createSession } from '../../lib/chatRepository';
import { useChatStore } from '../../store/useChatStore';
import { theme } from '../../config/theme';

export default function NewChatScreen() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const context = useChatStore.getState().diagnosticContext;
      const session = await createSession({
        title: context?.doenca_identificada ?? 'Nova conversa',
        originDiagnosticLocalId: context?.diagnostic_local_id ?? null,
      });
      useChatStore.getState().setDiagnosticContext(null);
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
