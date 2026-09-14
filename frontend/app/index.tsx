// frontend/app/index.tsx
// A Home é o resumo do app: blocos de prévia empilhados, e o produtor decide
// dali para onde ir. Até o sub-projeto 7 esta era a única tela que a
// reformulação não tinha tocado — tinha duas abas, busca e uma barra inferior
// falsa, e mostrava um mundo em que a foto não virava conversa.
//
// Duas consultas, nenhuma dentro de laço: `listSessions(3)` e `listMapSessions`.
// O bloco do mapa é contagem e não `MapView` — funciona offline e não depende
// da chave do Google Maps, que ainda não foi provisionada para Android.
import { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuthStore } from '../store/useAuthStore';
import { listSessions, listMapSessions, type SessionListItem } from '../lib/chatRepository';
import { resumoDoMapa, type ResumoMapa } from '../lib/mapPins';
import { ItemConversa } from '../components/ItemConversa';
import { ConnectionIndicator } from '../components/ConnectionIndicator';
import { theme } from '../config/theme';

const CONVERSAS_NA_HOME = 3;

export default function HomeScreen() {
  const router = useRouter();
  const { logout } = useAuthStore();
  const [conversas, setConversas] = useState<SessionListItem[]>([]);
  const [mapa, setMapa] = useState<ResumoMapa>({ total: 0, problemas: 0, saudaveis: 0 });
  const [carregando, setCarregando] = useState(true);

  const recarregar = useCallback(async () => {
    try {
      const [recentes, linhasDoMapa] = await Promise.all([
        listSessions(CONVERSAS_NA_HOME),
        listMapSessions(),
      ]);
      setConversas(recentes);
      setMapa(resumoDoMapa(linhasDoMapa));
    } catch (erro) {
      // Resumo vazio é melhor que tela quebrada: os botões continuam levando
      // o produtor à câmera e às conversas.
      console.warn('[Home] Falha ao carregar o resumo.', erro);
    } finally {
      setCarregando(false);
    }
  }, []);

  // A cada foco: voltar da câmera precisa somar a análise nova ao mapa, e
  // voltar de uma conversa precisa refletir a mensagem nova na prévia.
  useFocusEffect(
    useCallback(() => {
      void recarregar();
    }, [recarregar])
  );

  const sair = useCallback(async () => {
    try {
      await logout();
      Toast.show({ type: 'success', text1: 'Sessão encerrada' });
    } catch {
      Toast.show({ type: 'error', text1: 'Não foi possível sair', text2: 'Tente novamente.' });
    }
  }, [logout]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerEsquerda}>
          <Ionicons name="leaf" size={26} color={theme.colors.primary} />
          <Text style={styles.logo}>Crop.AI</Text>
        </View>
        <View style={styles.headerDireita}>
          <ConnectionIndicator />
          <TouchableOpacity
            onPress={() => router.push('/catalogo')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Abrir o catálogo de doenças"
          >
            <Ionicons name="book-outline" size={24} color={theme.colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => void sair()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Sair da conta"
          >
            <Ionicons name="log-out-outline" size={24} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.conteudo} showsVerticalScrollIndicator={false}>
        {/* Bloco: conversas */}
        <TouchableOpacity
          style={styles.blocoTitulo}
          onPress={() => router.push('/chat')}
          accessibilityRole="button"
          accessibilityLabel="Ver todas as conversas"
        >
          <Text style={styles.blocoTituloTexto}>CONVERSAS</Text>
          <Text style={styles.blocoSeta}>›</Text>
        </TouchableOpacity>

        <View style={styles.bloco}>
          {carregando ? (
            <ActivityIndicator color={theme.colors.primary} style={styles.blocoCarregando} />
          ) : conversas.length === 0 ? (
            <Text style={styles.blocoVazio}>
              Nenhuma conversa ainda. Tire uma foto de uma folha ou comece uma conversa com o
              Agrônomo Virtual.
            </Text>
          ) : (
            conversas.map((item) => (
              <ItemConversa
                key={item.id}
                item={item}
                onPress={() => router.push(`/chat/${item.id}`)}
              />
            ))
          )}
        </View>

        {/* Bloco: mapa */}
        <TouchableOpacity
          style={styles.blocoTitulo}
          onPress={() => router.push('/mapa')}
          accessibilityRole="button"
          accessibilityLabel="Abrir o mapa de análises"
        >
          <Text style={styles.blocoTituloTexto}>MAPA DE ANÁLISES</Text>
          <Text style={styles.blocoSeta}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bloco, styles.blocoMapa]}
          onPress={() => router.push('/mapa')}
          accessibilityRole="button"
          accessibilityLabel={
            mapa.total === 0
              ? 'Nenhuma análise localizada ainda'
              : `${mapa.total} ${mapa.total === 1 ? 'análise mapeada' : 'análises mapeadas'}, ${mapa.problemas} com problema`
          }
        >
          {mapa.total === 0 ? (
            <Text style={styles.blocoVazio}>
              Nenhuma análise com localização ainda. As fotos que você tirar em campo aparecem aqui.
            </Text>
          ) : (
            <>
              <View style={styles.mapaTotalLinha}>
                <Ionicons name="location" size={22} color={theme.colors.primary} />
                <Text style={styles.mapaTotal}>
                  {mapa.total} {mapa.total === 1 ? 'análise mapeada' : 'análises mapeadas'}
                </Text>
              </View>
              <View style={styles.mapaContagens}>
                {/* "Problema" e não "doença": Fitotoxicidade é dano químico. */}
                <View style={styles.mapaContagem}>
                  <View style={[styles.ponto, { backgroundColor: theme.colors.warning }]} />
                  <Text style={styles.mapaContagemTexto}>{mapa.problemas} com problema</Text>
                </View>
                <View style={styles.mapaContagem}>
                  <View style={[styles.ponto, { backgroundColor: theme.colors.primary }]} />
                  <Text style={styles.mapaContagemTexto}>
                    {mapa.saudaveis} {mapa.saudaveis === 1 ? 'saudável' : 'saudáveis'}
                  </Text>
                </View>
              </View>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.analisar}
          onPress={() => router.push('/camera')}
          accessibilityRole="button"
          accessibilityLabel="Analisar uma folha com a câmera"
        >
          <Ionicons name="camera" size={22} color={theme.colors.surface} />
          <Text style={styles.analisarTexto}>Analisar</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerEsquerda: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  headerDireita: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  logo: {
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.xl,
    fontWeight: 'bold',
  },
  conteudo: { padding: theme.spacing.md, gap: theme.spacing.sm },
  blocoTitulo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.xs,
    paddingTop: theme.spacing.sm,
  },
  blocoTituloTexto: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.fontSize.xs,
    fontWeight: '700',
    letterSpacing: 1,
  },
  blocoSeta: { color: theme.colors.primary, fontSize: 22 },
  bloco: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  blocoCarregando: { paddingVertical: theme.spacing.lg },
  blocoVazio: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.fontSize.sm,
    lineHeight: 20,
    padding: theme.spacing.md,
  },
  blocoMapa: { padding: theme.spacing.md, gap: theme.spacing.sm },
  mapaTotalLinha: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  mapaTotal: {
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.md,
    fontWeight: '600',
  },
  mapaContagens: { gap: theme.spacing.xs, paddingLeft: theme.spacing.xs },
  mapaContagem: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  ponto: { width: 10, height: 10, borderRadius: theme.borderRadius.round },
  mapaContagemTexto: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.fontSize.sm,
  },
  analisar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.round,
    paddingVertical: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  analisarTexto: {
    color: theme.colors.surface,
    fontSize: theme.typography.fontSize.md,
    fontWeight: '600',
  },
});
