// frontend/app/chat/[sessionId].tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { engineRouter, type EngineError } from '../../lib/engine';
import {
  appendMessage,
  findUnansweredUserMessage,
  getSession,
  getSessionDiseaseId,
  listMessages,
  updateMessageAttachment,
  type ChatMessage,
  type ChatSession,
} from '../../lib/chatRepository';
import { buildCatalogContext } from '../../lib/catalogContext';
import { useChatStore } from '../../store/useChatStore';
import { useNetworkStore } from '../../store/useNetworkStore';
import { theme } from '../../config/theme';

const ERROR_MESSAGES: Record<EngineError, string> = {
  MODEL_NOT_LOADED: 'Modelo offline não instalado. A resposta chega quando a conexão voltar.',
  TIMEOUT: 'O Agrônomo IA demorou demais. Toque em tentar de novo.',
  LLM_UNAVAILABLE: 'O Agrônomo IA está indisponível. Toque em tentar de novo.',
  RATE_LIMITED: 'Muitas perguntas seguidas. Aguarde um instante.',
  TOKEN_EXPIRED: 'Sua sessão expirou. Entre novamente.',
  ABORTED: '',
  UNKNOWN: 'Não foi possível gerar a resposta. Toque em tentar de novo.',
};

export default function ChatSessionScreen() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);
  const [partial, setPartial] = useState<string | null>(null);
  // Distingue por que `partial` está na tela: resposta truncada por erro do
  // motor (rótulo "resposta incompleta") vs. resposta completa que só não
  // foi para o banco (rótulo "não salva") — os dois setam chatError, então
  // não dá para usar a presença dele como discriminador.
  const [partialUnsaved, setPartialUnsaved] = useState(false);
  const [lastFailed, setLastFailed] = useState<ChatMessage | null>(null);

  const { isStreaming, streamingContent, pendingResponseFor, modelLoadProgress } = useChatStore();
  const { connectionMode } = useNetworkStore();
  const isBusy = isStreaming || pendingResponseFor === sessionId;
  const modeLabel = connectionMode === 'FIELD' ? '🌾 Campo' : '☁️ Online';

  const reload = useCallback(async () => {
    if (!sessionId) return;
    const [s, list] = await Promise.all([getSession(sessionId), listMessages(sessionId)]);
    setSession(s);
    setMessages(list);
  }, [sessionId]);

  /**
   * Pede uma resposta ao roteador para a mensagem do usuário dada. A tela não
   * sabe qual motor responde — só entrega histórico, contexto e callbacks.
   */
  const requestResponse = useCallback(
    async (userMessage: ChatMessage) => {
      if (!sessionId) return;
      const store = useChatStore.getState();
      if (store.pendingResponseFor === sessionId) return;

      store.setPendingResponseFor(sessionId);
      store.resetStreaming();
      setChatError(null);
      setPartial(null);
      setPartialUnsaved(false);
      setLastFailed(null);

      const history = (await listMessages(sessionId)).filter((m) => m.id !== userMessage.id);
      const diseaseId = userMessage.attachment?.cvResult.diseaseId ?? (await getSessionDiseaseId(sessionId));
      let catalogContext = '';
      try {
        catalogContext = await buildCatalogContext(diseaseId);
      } catch (err) {
        console.warn('[Chat] Falha ao montar o contexto do catálogo; seguindo sem ele.', err);
      }

      const controller = new AbortController();
      abortRef.current = controller;
      let streamed = '';

      engineRouter.respond(
        {
          sessionId,
          history,
          userMessage: userMessage.content,
          attachment: userMessage.attachment ?? undefined,
          catalogContext,
        },
        {
          onToken: (token) => {
            streamed += token;
            useChatStore.getState().appendToStreaming(token);
          },
          onDone: async (meta) => {
            const source = meta.kind === 'LOCAL' ? 'LOCAL_SLM' : 'CLOUD_LLM';
            if (meta.imageS3Key && userMessage.attachment) {
              await updateMessageAttachment(userMessage.id, { ...userMessage.attachment, imageS3Key: meta.imageS3Key });
            }
            if (streamed.trim()) {
              try {
                await appendMessage({ sessionId, role: 'assistant', content: streamed, source, latencyMs: meta.latencyMs });
              } catch {
                try {
                  await appendMessage({ sessionId, role: 'assistant', content: streamed, source, latencyMs: meta.latencyMs });
                } catch {
                  // A resposta existe mas não foi para o banco. Mantém na tela
                  // pelo mesmo caminho do parcial — sumir em silêncio seria pior,
                  // e o texto pode conter dosagem de defensivo.
                  setPartial(streamed);
                  setPartialUnsaved(true);
                  setChatError('A resposta chegou mas não pôde ser salva. Copie o que precisar antes de sair da tela.');
                }
              }
            }
            useChatStore.getState().resetStreaming();
            useChatStore.getState().setPendingResponseFor(null);
            abortRef.current = null;
            await reload();
          },
          onError: (error) => {
            const text = useChatStore.getState().streamingContent;
            useChatStore.getState().resetStreaming();
            useChatStore.getState().setPendingResponseFor(null);
            abortRef.current = null;
            if (error === 'ABORTED') return;
            if (text.trim()) setPartial(text);
            setChatError(ERROR_MESSAGES[error]);
            setLastFailed(userMessage);
          },
        },
        controller.signal
      );
    },
    [sessionId, reload]
  );

  // Carrega a sessão e, se a última mensagem é uma foto sem resposta, dispara
  // sozinho (spec §3.3). É o que faz "tirar foto → cair no chat já respondendo"
  // ser só uma navegação, e resolve o app morto no meio da resposta.
  useEffect(() => {
    if (!sessionId) return;
    useChatStore.getState().setActiveSession(sessionId);
    (async () => {
      await reload();
      const pendente = await findUnansweredUserMessage(sessionId);
      if (pendente?.attachment) {
        // Foto: o produtor já pediu a análise ao disparar a câmera — responder
        // sozinho é o que ele espera, e resolve o app morto no meio da resposta.
        void requestResponse(pendente);
      } else if (pendente) {
        // Texto: re-executar custa tokens e surpreende. Só oferece.
        setLastFailed(pendente);
        setChatError('Esta pergunta ficou sem resposta.');
      }
    })();
    return () => {
      abortRef.current?.abort();
      useChatStore.getState().setActiveSession(null);
    };
  }, [sessionId, reload, requestResponse]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isBusy || !sessionId) return;
    setInput('');
    const userMessage = await appendMessage({ sessionId, role: 'user', content: text });
    await reload();
    void requestResponse(userMessage);
  }, [input, isBusy, sessionId, reload, requestResponse]);

  const retry = useCallback(() => {
    if (lastFailed) void requestResponse(lastFailed);
  }, [lastFailed, requestResponse]);

  const stopResponse = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';
    const content = item.content || (item.attachment ? '📷 Foto enviada para análise' : '');
    return (
      <View style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}>
        <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
          <Text style={[styles.messageText, isUser && styles.userText]}>{content}</Text>
          {!isUser && item.source && (
            <Text style={styles.sourceBadge}>{item.source === 'CLOUD_LLM' ? '☁️' : '📱'}</Text>
          )}
        </View>
      </View>
    );
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Voltar"
          >
            <Text style={styles.backButton}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {session?.title ?? 'Agrônomo Virtual'}
          </Text>
          <View style={[styles.modeBadge, connectionMode === 'FIELD' ? styles.fieldBadge : styles.onlineBadge]}>
            <Text style={styles.modeBadgeText}>{modeLabel}</Text>
          </View>
        </View>

        {modelLoadProgress !== null && (
          <View style={styles.slmLoadingBar}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <Text style={styles.slmLoadingText}>
              Preparando o Agrônomo Virtual... {Math.round(modelLoadProgress * 100)}%
            </Text>
          </View>
        )}

        {chatError ? (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <Text style={styles.errorText}>{chatError}</Text>
            {lastFailed && (
              <TouchableOpacity onPress={retry} accessibilityRole="button" accessibilityLabel="Tentar de novo">
                <Text style={styles.retryText}>Tentar de novo</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        />

        {(isStreaming && streamingContent !== '') || partial ? (
          <View style={[styles.messageRow, styles.assistantRow]}>
            <View style={[styles.bubble, styles.assistantBubble]}>
              <Text style={styles.messageText}>{partial ?? streamingContent}</Text>
              {partial && <Text style={styles.partialNote}>{partialUnsaved ? 'não salva' : 'resposta incompleta'}</Text>}
            </View>
          </View>
        ) : null}

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Pergunte ao Agrônomo Virtual..."
            editable={!isBusy}
            multiline
            accessibilityLabel="Mensagem"
          />
          {isBusy ? (
            <TouchableOpacity style={styles.sendButton} onPress={stopResponse} accessibilityRole="button" accessibilityLabel="Parar">
              <Text style={styles.sendButtonText}>■</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.sendButton, !input.trim() && styles.sendButtonDisabled]}
              onPress={sendMessage}
              disabled={!input.trim()}
              accessibilityRole="button"
              accessibilityLabel="Enviar"
            >
              <Text style={styles.sendButtonText}>➤</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  backButton: { color: theme.colors.primary, fontSize: 24, marginRight: 12 },
  headerTitle: {
    flex: 1,
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
  },
  modeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.borderRadius.round },
  onlineBadge: { backgroundColor: theme.colors.primaryLight10 },
  fieldBadge: { backgroundColor: theme.colors.warning + '20' },
  modeBadgeText: { fontSize: theme.typography.fontSize.xs, fontWeight: '600', color: theme.colors.text },
  slmLoadingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceLight,
  },
  slmLoadingText: { color: theme.colors.textSecondary, fontSize: theme.typography.fontSize.sm },
  errorBanner: {
    backgroundColor: theme.colors.error + '15',
    padding: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  errorText: { color: theme.colors.error, fontSize: theme.typography.fontSize.sm },
  list: { padding: theme.spacing.md, gap: theme.spacing.sm },
  messageRow: { marginVertical: 2 },
  userRow: { alignItems: 'flex-end' },
  assistantRow: { alignItems: 'flex-start' },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.lg,
  },
  userBubble: {
    backgroundColor: theme.colors.primary,
    borderBottomRightRadius: theme.borderRadius.sm,
  },
  assistantBubble: {
    backgroundColor: theme.colors.surfaceLight,
    borderBottomLeftRadius: theme.borderRadius.sm,
  },
  messageText: { color: theme.colors.text, fontSize: theme.typography.fontSize.md, lineHeight: 22 },
  userText: { color: '#FFFFFF' },
  sourceBadge: { fontSize: 10, marginTop: 4, opacity: 0.5 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: theme.colors.surfaceLight,
    borderRadius: theme.borderRadius.round,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 10,
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.md,
    maxHeight: 100,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
  sendButtonText: { color: '#FFFFFF', fontSize: 18 },
  retryText: { color: theme.colors.primary, fontWeight: '600', marginTop: 6 },
  partialNote: { fontSize: 11, color: theme.colors.textSecondary, marginTop: 4, fontStyle: 'italic' },
});
