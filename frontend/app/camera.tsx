import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Camera, useCameraDevice, useCameraPermission, usePhotoOutput } from 'react-native-vision-camera';

import { theme } from '../config/theme';
import { Button } from '../components/Button';
import { useNetworkStore } from '../store/useNetworkStore';
import { runImageInference, type InferenceResult } from '../lib/inference';
import { resolveDiseaseName } from '../lib/diagnosisDetails';
import { startDiagnosisSession } from '../lib/diagnosisSessionService';

/** Região de soja em Sorriso, MT — usada quando o GPS nega ou demora. */
const GPS_PADRAO = { latitude: -12.5422, longitude: -55.7144 };

/** Imagem mínima para o simulador de diagnóstico; só existe sob __DEV__. */
const IMAGEM_MOCK =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const CASOS_DEBUG = [
  { rotulo: 'Ferrugem Asiática', id: '3f34559c-6a12-4eb2-a42e-cf629ec2e9e6', cor: theme.colors.error },
  { rotulo: 'Mancha Alvo', id: '5be520ca-a6fc-46cd-ae38-fc62157a44f1', cor: theme.colors.error },
  { rotulo: 'Antracnose', id: '1d1c8f61-e0ad-4670-b74d-5c0a8f89e49a', cor: theme.colors.error },
  { rotulo: 'Planta Saudável', id: 'Saudável', cor: theme.colors.primary },
  { rotulo: 'Fitotoxicidade', id: 'Fitotoxicidade', cor: theme.colors.warning },
];

type Etapa = 'VISOR' | 'ANALISANDO' | 'CONFIRMACAO';

interface Captura {
  uri: string;
  inference: InferenceResult;
  diseaseName: string;
}

export default function CameraScreen() {
  const router = useRouter();
  const { connectionMode } = useNetworkStore();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  // Na v5 a captura sai do output, não de um ref no componente: o <Camera>
  // recebe os outputs e o photoOutput é quem dispara.
  const photoOutput = usePhotoOutput();

  const [etapa, setEtapa] = useState<Etapa>('VISOR');
  const [captura, setCaptura] = useState<Captura | null>(null);
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [gps, setGps] = useState(GPS_PADRAO);
  const [confirmando, setConfirmando] = useState(false);
  const [debugAberto, setDebugAberto] = useState(false);

  /** O obturador só faz sentido quando há permissão E sensor. */
  const podeCapturar = hasPermission && !!device;

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setGps({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      } catch {
        // O padrão já está no estado; um diagnóstico sem coordenada exata vale
        // mais do que nenhum diagnóstico.
        console.warn('[Camera] GPS indisponível; usando a coordenada padrão.');
      }
    })();
  }, []);

  /**
   * Roda a inferência em memória e mostra o resultado para confirmação.
   * Nada é gravado aqui: 3 a 5 tentativas até um bom quadro é o normal em
   * campo, e cada tentativa persistida custaria uma sessão no histórico, um
   * PUT no S3 e uma chamada paga ao modelo.
   */
  const analisar = useCallback(async (uri: string, alvoForcado?: string) => {
    setEtapa('ANALISANDO');
    try {
      const inference = await runImageInference(uri, alvoForcado);
      const diseaseName = await resolveDiseaseName(inference.diseaseId);
      setCaptura({ uri, inference, diseaseName });
      setEtapa('CONFIRMACAO');
    } catch {
      console.error('[Camera] Falha ao rodar a inferência local.');
      Toast.show({
        type: 'error',
        text1: 'Erro de diagnóstico',
        text2: 'Não foi possível analisar a imagem. Tente de novo.',
      });
      setCaptura(null);
      setEtapa('VISOR');
    }
  }, []);

  const capturar = useCallback(async () => {
    // useCameraDevice enumera o hardware sem depender da permissão, então num
    // aparelho recém-instalado `device` já existe enquanto hasPermission ainda
    // é false. Sem esta guarda o obturador dispararia capturePhoto num output
    // que não está ligado a nenhum <Camera> montado, e o produtor veria "erro
    // de captura" em vez de saber que falta conceder a permissão.
    if (!hasPermission) {
      Toast.show({
        type: 'info',
        text1: 'Permissão de câmera',
        text2: 'Conceda a permissão para tirar a foto.',
      });
      return;
    }
    if (!device) {
      Toast.show({ type: 'error', text1: 'Câmera', text2: 'O visor ainda não inicializou.' });
      return;
    }
    try {
      const foto = await photoOutput.capturePhoto({ flashMode: flash }, {});
      let caminho: string;
      try {
        // A foto nasce em memória. saveToTemporaryFileAsync devolve caminho de
        // sistema de arquivos, sem o prefixo file:// — o resto do pipeline
        // (inferência, persistência) espera uma URI, daí a concatenação.
        caminho = await foto.saveToTemporaryFileAsync();
      } finally {
        // Obrigatório: a foto segura memória nativa grande, e sem dispose o
        // runtime de JS pode demorar a liberá-la a ponto de esgotar recurso.
        foto.dispose();
      }
      await analisar(`file://${caminho}`);
    } catch {
      console.error('[Camera] Falha ao capturar do sensor.');
      Toast.show({ type: 'error', text1: 'Erro de captura', text2: 'Não foi possível tirar a foto.' });
    }
  }, [analisar, device, flash, hasPermission, photoOutput]);

  const escolherDaGaleria = useCallback(async () => {
    try {
      const resultado = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.9,
      });
      if (!resultado.canceled && resultado.assets?.[0]?.uri) {
        await analisar(resultado.assets[0].uri);
      }
    } catch {
      console.error('[Camera] Falha ao abrir a galeria.');
      Toast.show({ type: 'error', text1: 'Galeria', text2: 'Não foi possível acessar as fotos.' });
    }
  }, [analisar]);

  const repetir = useCallback(() => {
    setCaptura(null);
    setEtapa('VISOR');
  }, []);

  const confirmar = useCallback(async () => {
    if (!captura || confirmando) return;
    setConfirmando(true);
    try {
      const { sessionId } = await startDiagnosisSession({
        imageUri: captura.uri,
        inference: captura.inference,
        diseaseName: captura.diseaseName,
        gps,
        connectionMode,
      });
      // Volta ao visor antes de navegar: ao retornar da conversa, o produtor
      // encontra a câmera pronta para a próxima foto, não a confirmação velha.
      setCaptura(null);
      setEtapa('VISOR');
      setConfirmando(false);
      router.push(`/chat/${sessionId}`);
    } catch {
      console.error('[Camera] Falha ao criar a conversa do diagnóstico.');
      Toast.show({
        type: 'error',
        text1: 'Não foi possível abrir a conversa',
        text2: 'Nada foi salvo. Tente de novo.',
      });
      setConfirmando(false);
    }
  }, [captura, confirmando, gps, connectionMode, router]);

  if (etapa === 'ANALISANDO') {
    return (
      <View style={styles.centro}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.centroTitulo}>Analisando a folha…</Text>
        <Text style={styles.centroTexto}>O modelo roda no aparelho, sem precisar de internet.</Text>
      </View>
    );
  }

  if (etapa === 'CONFIRMACAO' && captura) {
    return (
      <SafeAreaView style={styles.confirmacao}>
        <Image source={{ uri: captura.uri }} style={styles.fotoCheia} resizeMode="cover" />

        <View style={styles.chip}>
          <Text style={styles.chipTexto}>
            {captura.diseaseName} · {Math.round(captura.inference.confidence * 100)}%
          </Text>
        </View>

        <View style={styles.acoes}>
          <TouchableOpacity
            style={styles.repetir}
            onPress={repetir}
            disabled={confirmando}
            accessibilityRole="button"
            accessibilityLabel="Repetir a foto"
          >
            <Text style={styles.repetirTexto}>Repetir</Text>
          </TouchableOpacity>
          <Button
            title="Analisar"
            onPress={confirmar}
            loading={confirmando}
            variant="primary"
            style={styles.analisar}
            accessibilityLabel="Analisar esta foto e abrir a conversa"
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.barraTopo}>
        <TouchableOpacity
          style={styles.botaoCirculo}
          onPress={() => router.replace('/')}
          accessibilityRole="button"
          accessibilityLabel="Fechar a câmera"
        >
          <Ionicons name="close" size={24} color="#FFFFFF" />
        </TouchableOpacity>

        {__DEV__ ? (
          <TouchableOpacity
            style={styles.botaoCirculo}
            onPress={() => setDebugAberto(true)}
            accessibilityRole="button"
            accessibilityLabel="Abrir o simulador de diagnóstico"
          >
            <Ionicons name="bug-outline" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        ) : null}
      </View>

      {connectionMode === 'FIELD' || connectionMode === 'DEGRADED' ? (
        <View style={styles.selo}>
          <Ionicons
            name={connectionMode === 'FIELD' ? 'cloud-offline' : 'warning-outline'}
            size={16}
            color="#FFFFFF"
          />
          <Text style={styles.seloTexto}>
            {connectionMode === 'FIELD' ? 'Modo offline ativo' : 'Conexão instável'}
          </Text>
        </View>
      ) : null}

      <View style={styles.visor}>
        {!hasPermission ? (
          <View style={styles.permissao}>
            <Ionicons name="camera-reverse-outline" size={64} color={theme.colors.textSecondary} />
            <Text style={styles.permissaoTitulo}>Permissão de câmera</Text>
            <Text style={styles.permissaoTexto}>
              O diagnóstico roda no aparelho e precisa da câmera traseira.
            </Text>
            <Button
              title="Conceder permissão"
              onPress={requestPermission}
              variant="primary"
              style={{ marginTop: theme.spacing.md }}
            />
          </View>
        ) : !device ? (
          <View style={styles.permissao}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={styles.permissaoTexto}>Carregando o sensor traseiro…</Text>
          </View>
        ) : (
          <>
            <Camera
              style={StyleSheet.absoluteFill}
              device={device}
              isActive={true}
              outputs={[photoOutput]}
            />
            <View style={styles.guia} pointerEvents="none">
              <Text style={styles.guiaTexto}>Centralize a folha doente aqui</Text>
            </View>
          </>
        )}
      </View>

      <View style={styles.controles}>
        <TouchableOpacity
          style={styles.acessorio}
          onPress={escolherDaGaleria}
          accessibilityRole="button"
          accessibilityLabel="Escolher uma foto da galeria"
        >
          <Ionicons name="images-outline" size={24} color="#FFFFFF" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.obturador, !podeCapturar && styles.obturadorDesabilitado]}
          onPress={capturar}
          disabled={!podeCapturar}
          accessibilityRole="button"
          accessibilityState={{ disabled: !podeCapturar }}
          accessibilityLabel="Tirar foto para diagnóstico"
        >
          <View style={styles.obturadorInterno}>
            <Ionicons name="camera" size={28} color="#FFFFFF" />
          </View>
        </TouchableOpacity>

        {podeCapturar ? (
          <TouchableOpacity
            style={styles.acessorio}
            onPress={() => setFlash((atual) => (atual === 'off' ? 'on' : 'off'))}
            accessibilityRole="button"
            accessibilityLabel={flash === 'on' ? 'Desligar o flash' : 'Ligar o flash'}
          >
            <Ionicons name={flash === 'on' ? 'flash' : 'flash-off'} size={24} color="#FFFFFF" />
          </TouchableOpacity>
        ) : (
          <View style={styles.acessorio} />
        )}
      </View>

      <View style={styles.abas}>
        <View
          style={styles.abaAtiva}
          accessibilityRole="tab"
          accessibilityState={{ selected: true }}
          accessibilityLabel="Câmera, aba atual"
        >
          <Ionicons name="camera" size={24} color={theme.colors.primary} />
          <Text style={styles.abaRotuloAtivo}>Câmera</Text>
        </View>
        <TouchableOpacity
          style={styles.aba}
          onPress={() => router.push('/chat')}
          accessibilityRole="tab"
          accessibilityLabel="Abrir uma conversa nova"
        >
          <Ionicons name="chatbubbles-outline" size={24} color={theme.colors.textSecondary} />
          <Text style={styles.abaRotulo}>Conversa</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.aba}
          onPress={() => router.replace('/')}
          accessibilityRole="tab"
          accessibilityLabel="Abrir o catálogo"
        >
          <Ionicons name="book-outline" size={24} color={theme.colors.textSecondary} />
          <Text style={styles.abaRotulo}>Catálogo</Text>
        </TouchableOpacity>
      </View>

      {__DEV__ ? (
        <Modal
          visible={debugAberto}
          transparent
          animationType="slide"
          onRequestClose={() => setDebugAberto(false)}
        >
          <View style={styles.debugFundo}>
            <View style={styles.debugPainel}>
              <View style={styles.debugCabecalho}>
                <Text style={styles.debugTitulo}>Simulador de diagnóstico</Text>
                <TouchableOpacity onPress={() => setDebugAberto(false)} accessibilityLabel="Fechar">
                  <Ionicons name="close-circle" size={28} color={theme.colors.text} />
                </TouchableOpacity>
              </View>
              <Text style={styles.debugTexto}>
                Força um resultado sem precisar de uma folha real. A imagem é um mock e o upload
                dela falha de propósito — a segunda opinião cai em SKIPPED.
              </Text>
              {CASOS_DEBUG.map((caso) => (
                <TouchableOpacity
                  key={caso.id}
                  style={[styles.debugOpcao, { borderLeftColor: caso.cor }]}
                  onPress={() => {
                    setDebugAberto(false);
                    void analisar(IMAGEM_MOCK, caso.id);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={caso.rotulo}
                >
                  <Text style={styles.debugOpcaoTexto}>{caso.rotulo}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background, padding: theme.spacing.lg },
  centroTitulo: { color: theme.colors.text, fontSize: theme.typography.fontSize.lg, fontWeight: '600', marginTop: theme.spacing.md },
  centroTexto: { color: theme.colors.textSecondary, fontSize: theme.typography.fontSize.sm, marginTop: 4, textAlign: 'center' },

  confirmacao: { flex: 1, backgroundColor: '#000000' },
  fotoCheia: { ...StyleSheet.absoluteFill },
  chip: {
    position: 'absolute',
    top: 72,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.72)',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.round,
  },
  chipTexto: { color: '#FFFFFF', fontSize: theme.typography.fontSize.md, fontWeight: '600' },
  acoes: {
    position: 'absolute',
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    bottom: theme.spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  repetir: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    alignItems: 'center',
  },
  repetirTexto: { color: '#FFFFFF', fontSize: theme.typography.fontSize.md, fontWeight: '600' },
  analisar: { flex: 1 },

  barraTopo: { flexDirection: 'row', justifyContent: 'space-between', padding: theme.spacing.md },
  botaoCirculo: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  selo: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.72)',
    paddingHorizontal: theme.spacing.md, paddingVertical: 6,
    borderRadius: theme.borderRadius.round,
  },
  seloTexto: { color: '#FFFFFF', fontSize: theme.typography.fontSize.xs, fontWeight: '600' },
  visor: { flex: 1, margin: theme.spacing.md, borderRadius: theme.borderRadius.lg, overflow: 'hidden', backgroundColor: '#111111' },
  guia: { ...StyleSheet.absoluteFill, alignItems: 'center', paddingTop: theme.spacing.lg },
  guiaTexto: {
    color: '#FFFFFF', fontSize: theme.typography.fontSize.sm,
    backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: theme.spacing.md, paddingVertical: 6,
    borderRadius: theme.borderRadius.round,
  },
  permissao: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg, backgroundColor: theme.colors.background },
  permissaoTitulo: { color: theme.colors.text, fontSize: theme.typography.fontSize.lg, fontWeight: '600', marginTop: theme.spacing.md },
  permissaoTexto: { color: theme.colors.textSecondary, fontSize: theme.typography.fontSize.sm, textAlign: 'center', marginTop: 4 },
  controles: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md },
  acessorio: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
  obturadorDesabilitado: { opacity: 0.4 },
  obturador: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  obturadorInterno: { width: 60, height: 60, borderRadius: 30, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  abas: { flexDirection: 'row', backgroundColor: theme.colors.background, borderTopWidth: 1, borderTopColor: theme.colors.border },
  aba: { flex: 1, alignItems: 'center', paddingVertical: theme.spacing.sm },
  abaAtiva: { flex: 1, alignItems: 'center', paddingVertical: theme.spacing.sm },
  abaRotulo: { color: theme.colors.textSecondary, fontSize: theme.typography.fontSize.xxs, marginTop: 2 },
  abaRotuloAtivo: { color: theme.colors.primary, fontSize: theme.typography.fontSize.xxs, fontWeight: '600', marginTop: 2 },

  debugFundo: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  debugPainel: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: theme.borderRadius.xl,
    borderTopRightRadius: theme.borderRadius.xl,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  debugCabecalho: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  debugTitulo: { color: theme.colors.text, fontSize: theme.typography.fontSize.lg, fontWeight: '700' },
  debugTexto: { color: theme.colors.textSecondary, fontSize: theme.typography.fontSize.xs },
  debugOpcao: {
    borderLeftWidth: 4,
    backgroundColor: theme.colors.surfaceLight,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  debugOpcaoTexto: { color: theme.colors.text, fontSize: theme.typography.fontSize.sm },
});
