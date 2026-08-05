// frontend/app/chat.tsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
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
import { useRouter } from 'expo-router';
import { useChatStore, ChatMessage } from '../store/useChatStore';
import { useNetworkStore } from '../store/useNetworkStore';
import { streamCloudChat } from '../lib/cloudChatService';
import {
  loadSlmModel,
  slmChat,
  unloadSlmModel,
} from '../lib/slmChatService';
import { dbDriver } from '../db/sqlite';
import { theme } from '../config/theme';

export default function ChatScreen() {
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);
  const [input, setInput] = useState('');
  const [slmStatus, setSlmStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [slmProgress, setSlmProgress] = useState(0);
  const [requestPending, setRequestPending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const {
    history,
    isStreaming,
    streamingContent,
    sessionId,
    diagnosticContext,
    addUserMessage,
    appendToStreaming,
    finalizeStreaming,
    getCloudHistory,
    getSlmHistory,
  } = useChatStore();

  const { connectionMode } = useNetworkStore();
  const isField = connectionMode === 'FIELD';
  const isBusy = isStreaming || requestPending;

  const prevConnectionMode = useRef(connectionMode);

  // JIT load SLM when entering Field mode
  useEffect(() => {
    if (isField && slmStatus === 'idle') {
      setSlmStatus('loading');
      loadSlmModel((p) => {
        setSlmProgress(p.progress);
        if (p.loaded) setSlmStatus('ready');
      }).then((ok) => {
        if (!ok) setSlmStatus('error');
      });
    }
  }, [isField]);

  // Context handoff when network mode transitions
  useEffect(() => {
    const prev = prevConnectionMode.current;
    prevConnectionMode.current = connectionMode;

    if ((prev === 'ONLINE' || prev === 'DEGRADED') && connectionMode === 'FIELD') {
      // ONLINE → FIELD: condense history to 10 messages for SLM
      useChatStore.getState().condenseForSlm();
    }
    // FIELD → ONLINE: no history change needed — next cloud request
    // will include the full history with the expandForCloud() note
  }, [connectionMode]);

  // Release SLM when leaving screen
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      abortControllerRef.current?.abort();
      unloadSlmModel();
    };
  }, []);

  const getSqliteContext = useCallback(async (): Promise<string> => {
    const ctx = diagnosticContext;
    if (!ctx?.doenca_identificada) return '';

    try {
      const res = await dbDriver.execute(
        `SELECT d.nome_comum, d.nome_cientifico, d.sintomas,
                def.nome_comercial, def.ingrediente_ativo,
                dd.dosagem_recomendada, dd.carencia_dias
         FROM doencas d
         JOIN doenca_defensivo dd ON dd.id_doenca = d.id
         JOIN defensivos def ON def.id = dd.id_defensivo
         WHERE d.nome_comum = ?`,
        [ctx.doenca_identificada]
      );

      if (res.rows._array.length === 0) return '';
      const rows = res.rows._array;
      const d = rows[0];
      let txt = `Doença: ${d.nome_comum} (${d.nome_cientifico})\nSintomas: ${d.sintomas}\n\nDefensivos:\n`;
      for (const row of rows) {
        txt += `- ${row.nome_comercial} (${row.ingrediente_ativo}) — ${row.dosagem_recomendada} — Carência: ${row.carencia_dias} dias\n`;
      }
      return txt;
    } catch {
      return '';
    }
  }, [diagnosticContext]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isBusy || (isField && slmStatus !== 'ready')) return;
    const text = input.trim();
    setInput('');
    setChatError(null);
    setRequestPending(true);
    addUserMessage(text);

    if (isField) {
      abortControllerRef.current = new AbortController();
      const sqliteCtx = await getSqliteContext();
      const slmHistory = getSlmHistory();

      const slmStart = Date.now();
      let slmResponse = '';
      try {
        await slmChat({
          messages: [...slmHistory, { role: 'user', content: text }],
          sqliteContext: sqliteCtx,
          onToken: (token) => {
            slmResponse += token;
            appendToStreaming(token);
          },
          signal: abortControllerRef.current.signal,
        });
        finalizeStreaming('LOCAL_SLM');
      } catch {
        finalizeStreaming('LOCAL_SLM');
        if (!abortControllerRef.current.signal.aborted) {
          setChatError('Não foi possível gerar a resposta local. Tente novamente.');
        }
      } finally {
        setRequestPending(false);
        if (slmResponse.trim()) {
          useChatStore.getState().logSlmInteraction(text, slmResponse, Date.now() - slmStart);
        }
      }
    } else {
      const cloudHistory = getCloudHistory();

      // If returning from FIELD mode, prepend note about prior offline responses
      const offlineNote = useChatStore.getState().expandForCloud();
      const historyWithNote = history.some(m => m.source === 'LOCAL_SLM') && cloudHistory.length > 0
        ? [
            { role: 'user' as const, content: `[Contexto do sistema: ${offlineNote}]` },
            ...cloudHistory,
          ]
        : cloudHistory;

      cleanupRef.current = streamCloudChat({
        sessionId,
        message: text,
        history: historyWithNote,
        context: diagnosticContext
          ? {
              cultura: diagnosticContext.cultura,
              doenca_identificada: diagnosticContext.doenca_identificada,
              confianca_visao: diagnosticContext.confianca_visao,
            }
          : undefined,
        imageS3Key: diagnosticContext?.image_s3_key,
        onChunk: (chunk) => appendToStreaming(chunk),
        onDone: () => {
          setRequestPending(false);
          finalizeStreaming('CLOUD_LLM');
        },
        onError: () => {
          setRequestPending(false);
          finalizeStreaming('CLOUD_LLM');
          setChatError('O Agrônomo IA está indisponível. Verifique a conexão e tente novamente.');
        },
      });
    }
  }, [input, isBusy, isField, slmStatus, sessionId, diagnosticContext]);

  const stopResponse = useCallback(() => {
    abortControllerRef.current?.abort();
    cleanupRef.current?.();
    cleanupRef.current = null;
    setRequestPending(false);
    finalizeStreaming(isField ? 'LOCAL_SLM' : 'CLOUD_LLM');
  }, [finalizeStreaming, isField]);

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    if (item.role === 'system') return null;
    const isUser = item.role === 'user';
    return (
      <View style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}>
        <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
          <Text style={[styles.messageText, isUser && styles.userText]}>{item.content}</Text>
          {!isUser && (
            <Text style={styles.sourceBadge}>
              {item.source === 'CLOUD_LLM' ? '☁️' : '📱'}
            </Text>
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
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Voltar"
          >
            <Text style={styles.backButton}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Agrônomo Virtual</Text>
          <View style={[styles.modeBadge, isField ? styles.fieldBadge : styles.onlineBadge]}>
            <Text style={styles.modeBadgeText}>{isField ? '🌾 Campo' : '☁️ Online'}</Text>
          </View>
        </View>

        {/* SLM loading indicator */}
        {isField && slmStatus === 'loading' && (
          <View style={styles.slmLoadingBar}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <Text style={styles.slmLoadingText}>
              Preparando o Agrônomo Virtual... {Math.round(slmProgress * 100)}%
            </Text>
          </View>
        )}

        {isField && slmStatus === 'error' && (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <Text style={styles.errorText}>
              Modelo local não disponível. Conecte-se à internet para usar o chat.
            </Text>
          </View>
        )}

        {chatError && (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <Text style={styles.errorText}>{chatError}</Text>
          </View>
        )}

        {/* Message list */}
        <FlatList
          ref={flatListRef}
          data={history}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messagesList}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Como posso ajudar na sua lavoura?</Text>
              <Text style={styles.emptyText}>
                Pergunte sobre sintomas, manejo ou o diagnóstico recém-realizado.
              </Text>
            </View>
          }
          accessibilityLabel="Histórico da conversa"
        />

        {/* Streaming message */}
        {isStreaming && streamingContent !== '' && (
          <View style={[styles.bubble, styles.assistantBubble, styles.streamingContainer]}>
            <Text style={styles.messageText}>{streamingContent}</Text>
            <ActivityIndicator
              size="small"
              color={theme.colors.textSecondary}
              style={{ marginTop: 4 }}
            />
          </View>
        )}

        {/* Input row */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Pergunte sobre a lavoura..."
            placeholderTextColor={theme.colors.textSecondary}
            multiline
            maxLength={500}
            editable={!isBusy && !(isField && slmStatus !== 'ready')}
            accessibilityLabel="Mensagem para o agrônomo virtual"
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              (!input.trim() || isBusy || (isField && slmStatus !== 'ready')) && styles.sendButtonDisabled,
            ]}
            onPress={isBusy ? stopResponse : sendMessage}
            disabled={!isBusy && (!input.trim() || (isField && slmStatus !== 'ready'))}
            accessibilityRole="button"
            accessibilityLabel={isBusy ? 'Parar resposta' : 'Enviar mensagem'}
            accessibilityState={{ disabled: !isBusy && (!input.trim() || (isField && slmStatus !== 'ready')), busy: isBusy }}
          >
            <Text style={styles.sendButtonText}>{isBusy ? '■' : '➤'}</Text>
          </TouchableOpacity>
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
  messagesList: { padding: theme.spacing.md, gap: theme.spacing.sm },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: 72,
  },
  emptyTitle: {
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyText: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.fontSize.sm,
    lineHeight: 20,
    marginTop: theme.spacing.sm,
    textAlign: 'center',
  },
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
  streamingContainer: { marginHorizontal: theme.spacing.md, marginBottom: theme.spacing.sm },
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
});
