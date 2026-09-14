// frontend/app/mapa.tsx
// O mapa das análises. É a única tela do app que exige conexão: os tiles vêm
// da rede, e embutir mapa offline custaria centenas de MB num app que já
// carrega 1,5 GB de modelo. Em modo FIELD ela diz isso em vez de mostrar um
// quadrado cinza.
import { useCallback, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import MapView, { Marker } from 'react-native-maps';
import { listMapSessions } from '../lib/chatRepository';
import { montarPinos, regiaoInicial, type PinoMapa, type RegiaoMapa } from '../lib/mapPins';
import { useNetworkStore } from '../store/useNetworkStore';
import { theme } from '../config/theme';

export default function MapaScreen() {
  const router = useRouter();
  const { connectionMode } = useNetworkStore();
  const [pinos, setPinos] = useState<PinoMapa[]>([]);
  const [regiao, setRegiao] = useState<RegiaoMapa | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [selecionado, setSelecionado] = useState<PinoMapa | null>(null);

  const semRede = connectionMode === 'FIELD';

  const recarregar = useCallback(async () => {
    try {
      const lista = await montarPinos(await listMapSessions());
      setPinos(lista);
      setRegiao(regiaoInicial(lista));
    } catch (erro) {
      // Mapa vazio é melhor que tela quebrada: o produtor ainda volta para a
      // lista de conversas pelo cabeçalho.
      console.warn('[Mapa] Falha ao carregar as análises.', erro);
    } finally {
      setCarregando(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      // Não gasta leitura de banco quando a tela nem vai desenhar o mapa.
      if (semRede) {
        setCarregando(false);
        return;
      }
      void recarregar();
    }, [recarregar, semRede])
  );

  const cabecalho = (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={() => router.back()}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityRole="button"
        accessibilityLabel="Voltar"
      >
        <Text style={styles.backButton}>‹</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Mapa de análises</Text>
    </View>
  );

  if (semRede) {
    return (
      <SafeAreaView style={styles.container}>
        {cabecalho}
        <View style={styles.centro}>
          <Text style={styles.avisoTitulo}>O mapa precisa de conexão</Text>
          <Text style={styles.avisoTexto}>
            As análises continuam salvas no aparelho. Quando houver sinal, elas aparecem aqui.
          </Text>
          <TouchableOpacity
            style={styles.botaoConversas}
            onPress={() => router.push('/chat')}
            accessibilityRole="button"
            accessibilityLabel="Ver conversas"
          >
            <Text style={styles.botaoConversasTexto}>Ver conversas</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {cabecalho}

      {carregando || !regiao ? (
        <View style={styles.centro}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <View style={styles.flex}>
          <MapView style={styles.flex} initialRegion={regiao} onPress={() => setSelecionado(null)}>
            {pinos.map((pino) => (
              <Marker
                key={pino.sessionId}
                coordinate={{ latitude: pino.latitude, longitude: pino.longitude }}
                pinColor={pino.tipo === 'SAUDAVEL' ? theme.colors.primary : theme.colors.warning}
                onPress={() => setSelecionado(pino)}
                accessibilityLabel={`Análise: ${pino.doencaNome}`}
              />
            ))}
          </MapView>

          {pinos.length === 0 ? (
            <View style={styles.vazioSobreposto}>
              <Text style={styles.avisoTexto}>
                Nenhuma análise com localização ainda. As fotos que você tirar em campo aparecem aqui.
              </Text>
            </View>
          ) : null}

          {selecionado ? (
            <View style={styles.card}>
              {selecionado.imageUri ? (
                <Image
                  source={{ uri: selecionado.imageUri }}
                  style={styles.cardFoto}
                  resizeMode="cover"
                  accessibilityLabel="Foto analisada"
                />
              ) : null}
              <View style={styles.cardTexto}>
                {/* O nome da doença, não o título da conversa: o produtor pode
                    ter renomeado a conversa, mas o que a planta tem é fato. */}
                <Text style={styles.cardTitulo} numberOfLines={1}>
                  {selecionado.doencaNome}
                </Text>
                <Text style={styles.cardData}>{selecionado.dataRelativa}</Text>
              </View>
              <TouchableOpacity
                onPress={() => router.push(`/chat/${selecionado.sessionId}`)}
                accessibilityRole="button"
                accessibilityLabel="Abrir conversa"
              >
                <Text style={styles.cardAbrir}>Abrir</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      )}
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
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  avisoTitulo: {
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    marginBottom: theme.spacing.sm,
  },
  avisoTexto: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.fontSize.sm,
    textAlign: 'center',
  },
  botaoConversas: {
    marginTop: theme.spacing.lg,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.round,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  botaoConversasTexto: {
    color: theme.colors.surface,
    fontSize: theme.typography.fontSize.md,
    fontWeight: '600',
  },
  vazioSobreposto: {
    position: 'absolute',
    top: theme.spacing.md,
    left: theme.spacing.md,
    right: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
  },
  card: {
    position: 'absolute',
    left: theme.spacing.md,
    right: theme.spacing.md,
    bottom: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.sm,
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  cardFoto: { width: 48, height: 48, borderRadius: theme.borderRadius.md },
  cardTexto: { flex: 1 },
  cardTitulo: {
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.md,
    fontWeight: '600',
  },
  cardData: { color: theme.colors.textSecondary, fontSize: theme.typography.fontSize.xs },
  cardAbrir: {
    color: theme.colors.primary,
    fontSize: theme.typography.fontSize.md,
    fontWeight: '600',
    paddingHorizontal: theme.spacing.sm,
  },
});
