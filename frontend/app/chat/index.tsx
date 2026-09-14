// frontend/app/chat/index.tsx
// A lista das conversas. Até o sub-projeto 5 esta rota criava uma sessão nova
// a cada mount e redirecionava — por isso o app acumulava conversas vazias.
// Agora a conversa livre nasce na primeira mensagem, via o sentinela /chat/novo.
import { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  listSessions,
  renameSession,
  softDeleteSession,
  SESSAO_NOVA,
  TITULO_MAX,
  type SessionListItem,
} from '../../lib/chatRepository';
import { dataRelativa, previewDaSessao } from '../../lib/sessionListFormat';
import { theme } from '../../config/theme';

export default function HistoricoScreen() {
  const router = useRouter();
  const [sessoes, setSessoes] = useState<SessionListItem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [renomeando, setRenomeando] = useState<SessionListItem | null>(null);
  const [tituloNovo, setTituloNovo] = useState('');

  const recarregar = useCallback(async () => {
    try {
      setSessoes(await listSessions());
    } catch (erro) {
      // Lista vazia é melhor que tela quebrada: o produtor ainda consegue
      // começar uma conversa nova pelo botão.
      console.warn('[Histórico] Falha ao carregar as conversas.', erro);
    } finally {
      setCarregando(false);
    }
  }, []);

  // A cada foco, e não só na montagem: voltar de uma conversa precisa refletir
  // a mensagem nova na prévia e reordenar a lista por updated_at.
  useFocusEffect(
    useCallback(() => {
      void recarregar();
    }, [recarregar])
  );

  const confirmarApagar = useCallback(
    (item: SessionListItem) => {
      Alert.alert(
        'Apagar conversa',
        `"${item.title}" sai da lista.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Apagar',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                await softDeleteSession(item.id);
                await recarregar();
              })();
            },
          },
        ]
      );
    },
    [recarregar]
  );

  const abrirMenu = useCallback(
    (item: SessionListItem) => {
      Alert.alert(item.title, undefined, [
        {
          text: 'Renomear',
          onPress: () => {
            setTituloNovo(item.title);
            setRenomeando(item);
          },
        },
        { text: 'Apagar', style: 'destructive', onPress: () => confirmarApagar(item) },
        { text: 'Cancelar', style: 'cancel' },
      ]);
    },
    [confirmarApagar]
  );

  const confirmarRenomear = useCallback(async () => {
    if (!renomeando) return;
    await renameSession(renomeando.id, tituloNovo);
    setRenomeando(null);
    await recarregar();
  }, [renomeando, tituloNovo, recarregar]);

  const renderItem = useCallback(
    ({ item }: { item: SessionListItem }) => (
      <TouchableOpacity
        style={styles.item}
        onPress={() => router.push(`/chat/${item.id}`)}
        onLongPress={() => abrirMenu(item)}
        accessibilityRole="button"
        accessibilityLabel={`Conversa ${item.title}`}
        accessibilityHint="Toque para abrir, toque longo para renomear ou apagar"
      >
        <View style={styles.itemTexto}>
          <View style={styles.itemTopo}>
            {item.originDiagnosticLocalId ? <Text style={styles.marcaFoto}>📷</Text> : null}
            <Text style={styles.itemTitulo} numberOfLines={1}>
              {item.title}
            </Text>
          </View>
          <Text style={styles.itemPrevia} numberOfLines={1}>
            {previewDaSessao(item)}
          </Text>
        </View>
        <Text style={styles.itemData}>{dataRelativa(item.updatedAt)}</Text>
      </TouchableOpacity>
    ),
    [router, abrirMenu]
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
        >
          <Text style={styles.backButton}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Conversas</Text>
      </View>

      {carregando ? (
        <View style={styles.centro}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : sessoes.length === 0 ? (
        <View style={styles.centro}>
          <Text style={styles.vazioTitulo}>Nenhuma conversa ainda</Text>
          <Text style={styles.vazioTexto}>
            Tire uma foto de uma folha ou comece uma conversa com o Agrônomo Virtual.
          </Text>
        </View>
      ) : (
        <FlatList
          data={sessoes}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.lista}
          ItemSeparatorComponent={() => <View style={styles.separador} />}
        />
      )}

      <TouchableOpacity
        style={styles.botaoNova}
        onPress={() => router.push(`/chat/${SESSAO_NOVA}`)}
        accessibilityRole="button"
        accessibilityLabel="Nova conversa"
      >
        <Text style={styles.botaoNovaTexto}>+ Nova conversa</Text>
      </TouchableOpacity>

      <Modal visible={!!renomeando} transparent animationType="fade" onRequestClose={() => setRenomeando(null)}>
        <View style={styles.modalFundo}>
          <View style={styles.modalCaixa}>
            <Text style={styles.modalTitulo}>Renomear conversa</Text>
            <TextInput
              style={styles.modalInput}
              value={tituloNovo}
              onChangeText={setTituloNovo}
              maxLength={TITULO_MAX}
              autoFocus
              accessibilityLabel="Novo título"
            />
            <View style={styles.modalBotoes}>
              <TouchableOpacity onPress={() => setRenomeando(null)} accessibilityRole="button">
                <Text style={styles.modalCancelar}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => void confirmarRenomear()} accessibilityRole="button">
                <Text style={styles.modalSalvar}>Salvar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  vazioTitulo: {
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    marginBottom: theme.spacing.sm,
  },
  vazioTexto: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.fontSize.sm,
    textAlign: 'center',
  },
  lista: { paddingVertical: theme.spacing.sm },
  separador: { height: 1, backgroundColor: theme.colors.border, marginLeft: theme.spacing.md },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  itemTexto: { flex: 1 },
  itemTopo: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  marcaFoto: { fontSize: theme.typography.fontSize.sm },
  itemTitulo: {
    flex: 1,
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.md,
    fontWeight: '600',
  },
  itemPrevia: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.fontSize.sm,
    marginTop: 2,
  },
  itemData: { color: theme.colors.textSecondary, fontSize: theme.typography.fontSize.xs },
  botaoNova: {
    margin: theme.spacing.md,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.round,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
  },
  botaoNovaTexto: {
    color: theme.colors.surface,
    fontSize: theme.typography.fontSize.md,
    fontWeight: '600',
  },
  modalFundo: {
    flex: 1,
    backgroundColor: '#00000066',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  modalCaixa: {
    width: '100%',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
  },
  modalTitulo: {
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    marginBottom: theme.spacing.sm,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    color: theme.colors.text,
  },
  modalBotoes: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: theme.spacing.lg,
    marginTop: theme.spacing.md,
  },
  modalCancelar: { color: theme.colors.textSecondary, fontSize: theme.typography.fontSize.md },
  modalSalvar: {
    color: theme.colors.primary,
    fontSize: theme.typography.fontSize.md,
    fontWeight: '600',
  },
});
