// frontend/app/catalogo.tsx
// A enciclopédia de doenças. Até o sub-projeto 7 ela era uma aba da Home; virou
// tela própria quando a Home passou a ser um resumo de dois blocos.
// Funciona offline: o catálogo é semeado no SQLite e sincronizado por ETag.
import { useCallback, useState } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { listCatalogDiseases, type CatalogDisease } from '../lib/diagnosisDetails';
import { filtrarDoencas, rotuloSeveridade, tipoSeveridade } from '../lib/catalogo';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { theme } from '../config/theme';

export default function CatalogoScreen() {
  const router = useRouter();
  const [doencas, setDoencas] = useState<CatalogDisease[]>([]);
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(true);

  const recarregar = useCallback(async () => {
    try {
      setDoencas(await listCatalogDiseases());
    } catch (erro) {
      // Lista vazia é melhor que tela quebrada: o produtor ainda volta pelo cabeçalho.
      console.warn('[Catálogo] Falha ao carregar as doenças.', erro);
    } finally {
      setCarregando(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void recarregar();
    }, [recarregar])
  );

  const visiveis = filtrarDoencas(doencas, busca);

  const renderItem = useCallback(
    ({ item }: { item: CatalogDisease }) => (
      <Card>
        <View style={styles.cabecalhoDoenca}>
          <View style={styles.nomes}>
            <Text style={styles.nomeComum}>{item.nomeComum}</Text>
            {item.nomeCientifico ? (
              <Text style={styles.nomeCientifico}>{item.nomeCientifico}</Text>
            ) : null}
          </View>
          <Badge text={rotuloSeveridade(item.nivelSeveridade)} type={tipoSeveridade(item.nivelSeveridade)} />
        </View>

        <View style={styles.divisor} />

        <Text style={styles.rotuloSintomas}>Sintomas característicos:</Text>
        <Text style={styles.sintomas}>{item.sintomas ?? 'Sintomas não descritos no catálogo.'}</Text>
      </Card>
    ),
    []
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
        <Text style={styles.headerTitle}>Doenças da soja</Text>
      </View>

      <View style={styles.buscaContainer}>
        <View style={styles.busca}>
          <Ionicons name="search" size={20} color={theme.colors.textSecondary} />
          <TextInput
            placeholder="Buscar por nome ou sintoma…"
            placeholderTextColor={theme.colors.textSecondary}
            value={busca}
            onChangeText={setBusca}
            style={styles.buscaInput}
            accessibilityLabel="Buscar doenças no catálogo"
          />
          {busca ? (
            <TouchableOpacity
              onPress={() => setBusca('')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Limpar busca"
            >
              <Ionicons name="close-circle" size={18} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {carregando ? (
        <View style={styles.centro}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : visiveis.length === 0 ? (
        <View style={styles.centro}>
          <Ionicons name="book-outline" size={48} color={theme.colors.textSecondary} />
          <Text style={styles.vazioTexto}>
            {busca ? 'Nenhuma doença corresponde à busca.' : 'O catálogo ainda não foi carregado.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={visiveis}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.lista}
          keyboardShouldPersistTaps="handled"
        />
      )}
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
  buscaContainer: { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.md },
  busca: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceLight,
    borderRadius: theme.borderRadius.round,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  buscaInput: { flex: 1, color: theme.colors.text, fontSize: theme.typography.fontSize.md },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  vazioTexto: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.fontSize.sm,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
  },
  lista: { padding: theme.spacing.md, gap: theme.spacing.md },
  cabecalhoDoenca: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm },
  nomes: { flex: 1 },
  nomeComum: {
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.md,
    fontWeight: '600',
  },
  nomeCientifico: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.fontSize.sm,
    fontStyle: 'italic',
    marginTop: 2,
  },
  divisor: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: theme.spacing.sm,
  },
  rotuloSintomas: {
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
  },
  sintomas: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.fontSize.sm,
    lineHeight: 20,
    marginTop: 4,
  },
});
