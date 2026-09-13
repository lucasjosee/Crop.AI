import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Image,
  ScrollView,
  Platform,
  ActivityIndicator,
  Modal,
  TextInput,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';

import * as Crypto from 'expo-crypto';
import { theme } from '../config/theme';
import { dbDriver } from '../db/sqlite';
import { useNetworkStore } from '../store/useNetworkStore';
import { runImageInference, InferenceResult } from '../lib/inference';
import { saveImagePersistently } from '../lib/imageHelper';
import { discardDiagnosticDraft } from '../lib/diagnosticDraftService';
import { Button } from '../components/Button';
import { Badge } from '../components/Badge';
import { useChatStore } from '../store/useChatStore';
import {
  crossValidateDiagnostic,
  getCrossValidationPriority,
  markCrossValidationSkipped,
  type CrossValidationResult,
} from '../lib/crossValidationService';
import {
  buildDiagnosticChatContext,
  queueDiagnosisFeedback,
} from '../lib/diagnosisFeedbackService';

// Constant fallback GPS coordinate: Soy region in Sorriso, MT
const MATO_GROSSO_FALLBACK_GPS = { latitude: -12.5422, longitude: -55.7144 };

// Local base64 tiny green PNG placeholder for offline web mockup
const LOCAL_MOCK_IMAGE_BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// Conditional require for native packages to prevent web bundler crashes
let NativeCamera: any = null;
let _rawCameraPermissionHook: any = null;
let _rawCameraDeviceHook: any = null;

if (Platform.OS !== 'web') {
  try {
    const VisionCamera = require('react-native-vision-camera');
    NativeCamera = VisionCamera.Camera;
    _rawCameraPermissionHook = VisionCamera.useCameraPermission;
    _rawCameraDeviceHook = VisionCamera.useCameraDevice;
  } catch {
    console.warn('[Camera] Failed to load react-native-vision-camera dynamically.');
  }
}

// Stable module-level hook wrappers — always called unconditionally, satisfying Rules of Hooks.
// On web (or if VisionCamera failed to load), these return safe no-op values.
type PermissionResult = { hasPermission: boolean; requestPermission: () => Promise<boolean> };
const _useCameraPermission: () => PermissionResult =
  _rawCameraPermissionHook ?? (() => ({ hasPermission: false, requestPermission: async () => false }));

const _useCameraDevice: (position: 'back' | 'front') => any =
  _rawCameraDeviceHook ?? (() => null);

export default function CameraScreen() {
  const router = useRouter();
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const { connectionMode } = useNetworkStore();

  // Camera permission — hook called unconditionally every render (Rules of Hooks compliant)
  const { hasPermission: hasNativePermission, requestPermission: requestNativePermission } = _useCameraPermission();
  const nativeDevice = _useCameraDevice('back');

  const [flashMode, setFlashMode] = useState<'off' | 'on'>('off');
  const nativeCameraRef = useRef<any>(null);
  const webVideoRef = useRef<HTMLVideoElement>(null);
  const webStreamRef = useRef<MediaStream | null>(null);

  // States
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [inferenceResult, setInferenceResult] = useState<InferenceResult | null>(null);
  const [gpsLocation, setGpsLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  // Database detail states
  const [diseaseDetails, setDiseaseDetails] = useState<any | null>(null);
  const [defensivesList, setDefensivesList] = useState<any[]>([]);
  const [diagnosticLocalId, setDiagnosticLocalId] = useState<string | null>(null);
  const [imageS3Key, setImageS3Key] = useState<string | null>(null);
  const [crossValidationState, setCrossValidationState] = useState<
    'IDLE' | 'LOADING' | 'COMPLETE' | 'SKIPPED' | 'UNAVAILABLE'
  >('IDLE');
  const [crossValidationResult, setCrossValidationResult] =
    useState<CrossValidationResult | null>(null);
  const [feedbackChoice, setFeedbackChoice] = useState<
    'CORRECT' | 'INCORRECT' | 'OTHER' | 'LLM' | null
  >(null);
  const [feedbackNotes, setFeedbackNotes] = useState('');
  const [correctedDiseaseId, setCorrectedDiseaseId] = useState<string | null>(null);
  const [feedbackDiseases, setFeedbackDiseases] = useState<any[]>([]);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const diagnosticPersistenceRef = useRef<Promise<string> | null>(null);

  // Debug settings for dev simulation
  const [showDebugPanel, setShowDebugPanel] = useState(false);

  // 1. Initial setups: GPS + Web webcam (native camera permission handled reactively by hook)
  useEffect(() => {
    async function requestInitialPermissions() {
      // Location Request
      try {
        const { status: locStatus } = await Location.requestForegroundPermissionsAsync();
        if (locStatus === 'granted') {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          setGpsLocation({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
        } else {
          setGpsLocation(MATO_GROSSO_FALLBACK_GPS);
        }
      } catch {
        console.warn('[Camera] Geolocation request failed.');
        setGpsLocation(MATO_GROSSO_FALLBACK_GPS);
      }

      if (Platform.OS === 'web') {
        startWebcam();
      }
    }

    requestInitialPermissions();

    return () => {
      stopWebcam();
    };
  }, []);

  // Web Webcam controller
  const startWebcam = async () => {
    if (Platform.OS !== 'web') return;
    try {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: 1280, height: 720 },
        });
        webStreamRef.current = stream;
        if (webVideoRef.current) {
          webVideoRef.current.srcObject = stream;
        }
      }
    } catch {
      console.warn('[Camera] Webcam access denied or unavailable on web.');
      Toast.show({
        type: 'info',
        text1: 'Aviso de Câmera Web',
        text2: 'Câmera indisponível. Você pode usar a galeria para os testes.',
      });
    }
  };

  const stopWebcam = () => {
    if (Platform.OS !== 'web') return;
    try {
      // Clean up stream tracks to prevent memory leaks and keep camera indicator OFF
      if (webStreamRef.current) {
        webStreamRef.current.getTracks().forEach((track) => track.stop());
        webStreamRef.current = null;
      }
      if (webVideoRef.current) {
        webVideoRef.current.srcObject = null;
      }
    } catch (e) {
      console.log('Error stopping webcam:', e);
    }
  };

  // Toggle dynamic flash
  const handleToggleFlash = () => {
    setFlashMode((prev) => (prev === 'off' ? 'on' : 'off'));
  };

  // 2. Select image from Gallery (Alternative capture)
  const handlePickFromGallery = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.9,
      });

      if (!result.canceled && result.assets && result.assets[0].uri) {
        processDiagnostic(result.assets[0].uri);
      }
    } catch {
      console.error('[Camera] Pick image from gallery failed.');
      Toast.show({
        type: 'error',
        text1: 'Erro de Galeria',
        text2: 'Não foi possível acessar as fotos.',
      });
    }
  };

  // 3. Shutter trigger
  const handleCapturePhoto = async () => {
    if (Platform.OS === 'web') {
      if (webVideoRef.current) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = webVideoRef.current.videoWidth || 640;
          canvas.height = webVideoRef.current.videoHeight || 480;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(webVideoRef.current, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg');
            processDiagnostic(dataUrl);
          }
        } catch {
          console.error('[Camera] Canvas screenshot failed; using local fallback.');
          processDiagnostic(LOCAL_MOCK_IMAGE_BASE64);
        }
      } else {
        processDiagnostic(LOCAL_MOCK_IMAGE_BASE64);
      }
    } else {
      if (!nativeCameraRef.current) {
        Toast.show({
          type: 'error',
          text1: 'Erro de Câmera',
          text2: 'Visor da câmera ainda não inicializado.',
        });
        return;
      }
      try {
        const photo = await nativeCameraRef.current.takePhoto({
          flash: flashMode,
          enableAutoRedEyeReduction: true,
        });
        const localUri = `file://${photo.path}`;
        processDiagnostic(localUri);
      } catch {
        console.error('[Camera] Native capture failed.');
        Toast.show({
          type: 'error',
          text1: 'Erro de Captura',
          text2: 'Falha ao capturar foto do sensor.',
        });
      }
    }
  };

  // 4. Local processing & local AI inference
  const processDiagnostic = async (
    uri: string,
    forcedTarget?: string
  ) => {
    setIsProcessing(true);
    // Nova captura sem passar pelo Retake abandona o rascunho anterior do mesmo
    // jeito, então ele também precisa ser descartado.
    void discardAbandonedDraft(diagnosticLocalId, diagnosticPersistenceRef.current);
    setCapturedImage(uri);
    setDiagnosticLocalId(null);
    setImageS3Key(null);
    setCrossValidationState('IDLE');
    setCrossValidationResult(null);
    setFeedbackChoice(null);
    setFeedbackNotes('');
    setCorrectedDiseaseId(null);
    setFeedbackSubmitted(false);
    diagnosticPersistenceRef.current = null;
    stopWebcam();

    try {
      // A. Run inference (propagates real errors now)
      const result = await runImageInference(uri, forcedTarget);
      setInferenceResult(result);
      // O resultado local é liberado antes de qualquer operação de rede.
      setIsProcessing(false);

      // B. Load details from DB if not Healthy/Phytotoxicity
      let details: any | null = null;
      if (result.diseaseId !== 'Saudável' && result.diseaseId !== 'Fitotoxicidade') {
        details = await loadDetailsFromLocalDB(result.diseaseId);
      } else {
        setDiseaseDetails(null);
        setDefensivesList([]);
      }

      const diseasesRes = await dbDriver.execute('SELECT * FROM doencas;');
      setFeedbackDiseases(diseasesRes.rows._array);

      const persistence = persistDiagnosticAndStartCrossValidation(uri, result, details);
      diagnosticPersistenceRef.current = persistence;
      void persistence.catch(() => {
        console.error('[Camera] Failed to persist local diagnosis.');
      });
    } catch {
      console.error('[Camera] Diagnostic processing failed.');
      Toast.show({
        type: 'error',
        text1: 'Erro de Diagnóstico',
        text2: 'Ocorreu um erro ao rodar a inferência local.',
      });
      // Safe fallback reset
      setCapturedImage(null);
      if (Platform.OS === 'web') startWebcam();
    } finally {
      setIsProcessing(false);
    }
  };

  // Safe multi-query join fallback for Web & Native
  const loadDetailsFromLocalDB = async (diseaseId: string): Promise<any | null> => {
    try {
      // 1. Get Disease Info
      const diseaseRes = await dbDriver.execute(
        'SELECT * FROM doencas WHERE id = ?;',
        [diseaseId]
      );
      const details = diseaseRes.rows.length > 0 ? diseaseRes.rows.item(0) : null;
      setDiseaseDetails(details);

      // 2. Query relations manually
      const relationRes = await dbDriver.execute('SELECT * FROM doenca_defensivo;');
      const relations = [];
      for (let i = 0; i < relationRes.rows.length; i++) {
        relations.push(relationRes.rows.item(i));
      }
      const relevantRelations = relations.filter((r) => r.id_doenca === diseaseId);

      // 3. Query all defensives
      const defensivesRes = await dbDriver.execute('SELECT * FROM defensivos;');
      const allDefensives: any[] = [];
      for (let i = 0; i < defensivesRes.rows.length; i++) {
        allDefensives.push(defensivesRes.rows.item(i));
      }

      // 4. Manually map them
      const items = relevantRelations
        .map((rel) => {
          const match = allDefensives.find((d) => d.id === rel.id_defensivo);
          return match
            ? {
                ...match,
                dosagem_recomendada: rel.dosagem_recomendada,
                carencia_dias: rel.carencia_dias,
              }
            : null;
        })
        .filter(Boolean);

      setDefensivesList(items);
      return details;
    } catch {
      console.error('[Camera] SQLite lookup failed.');
      Toast.show({
        type: 'error',
        text1: 'Erro de Leitura local',
        text2: 'Não foi possível carregar os tratamentos recomendados.',
      });
      return null;
    }
  };

  const persistDiagnosticAndStartCrossValidation = async (
    sourceImageUri: string,
    result: InferenceResult,
    details: any | null
  ): Promise<string> => {
    const persistentPath = await saveImagePersistently(sourceImageUri);
    const localId = Crypto.randomUUID();
    const isSpecial = result.diseaseId === 'Saudável' || result.diseaseId === 'Fitotoxicidade';

    await dbDriver.execute(
      `INSERT INTO fila_diagnosticos (
        local_id, server_id, image_uri, image_s3_key, latitude, longitude,
        doenca_id, confianca_ia, modelo_usado, tempo_inferencia_ms,
        sync_status, retry_count, cross_validation_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        localId,
        null,
        persistentPath,
        null,
        gpsLocation?.latitude || MATO_GROSSO_FALLBACK_GPS.latitude,
        gpsLocation?.longitude || MATO_GROSSO_FALLBACK_GPS.longitude,
        isSpecial ? null : result.diseaseId,
        result.confidence,
        result.modelUsed,
        result.inferenceTimeMs,
        'PENDING',
        0,
        isSpecial || connectionMode !== 'ONLINE' ? 'SKIPPED' : 'PENDING',
      ]
    );
    setDiagnosticLocalId(localId);

    if (isSpecial || connectionMode !== 'ONLINE') {
      await markCrossValidationSkipped(localId);
      setCrossValidationState('SKIPPED');
      return localId;
    }

    setCrossValidationState('LOADING');
    void crossValidateDiagnostic({
      localId,
      imageUri: sourceImageUri,
      cvResult: {
        doencaId: result.diseaseId,
        doencaNome: details?.nome_comum ?? 'Doença identificada pelo modelo local',
        confianca: result.confidence,
        modeloUsado: result.modelUsed,
        tempoInferenciaMs: result.inferenceTimeMs,
      },
      onImageUploaded: setImageS3Key,
    })
      .then(({ imageS3Key: uploadedKey, result: secondOpinion }) => {
        setImageS3Key(uploadedKey);
        setCrossValidationResult(secondOpinion);
        setCrossValidationState('COMPLETE');
      })
      .catch(async (error) => {
        const errorCode = error?.code ?? 'LLM_UNAVAILABLE';
        await markCrossValidationSkipped(localId, errorCode);
        setCrossValidationState('UNAVAILABLE');
      });

    return localId;
  };

  // 5. Store and Forward - Save in Local SQLite
  const handleSaveToHistory = async () => {
    if (!capturedImage || !inferenceResult) return;

    try {
      await diagnosticPersistenceRef.current;

      Toast.show({
        type: 'success',
        text1: 'Diagnóstico Salvo!',
        text2: 'O registro foi salvo localmente e será enviado em rede.',
      });

      router.replace('/');
    } catch {
      console.error('[Camera] Failed to write local history.');
      Toast.show({
        type: 'error',
        text1: 'Erro de Banco de Dados',
        text2: 'Falha ao salvar o diagnóstico.',
      });
    }
  };

  // Reset and restart scanner
  /**
   * O local_id pode ainda não ter chegado ao state quando o produtor toca em
   * Retake — a persistência é disparada sem await. Por isso o descarte também
   * aguarda a promessa em voo antes de remover.
   */
  const discardAbandonedDraft = async (
    localId: string | null,
    pending: Promise<string> | null
  ) => {
    try {
      const resolved = localId ?? (pending ? await pending : null);
      await discardDiagnosticDraft(resolved);
    } catch {
      console.warn('[Camera] Não foi possível descartar o rascunho abandonado.');
    }
  };

  const handleResetCamera = () => {
    // O rascunho já foi persistido automaticamente após a inferência; sem
    // descartá-lo aqui, cada tentativa refeita sobe para o servidor no próximo
    // sync e consome um PUT no S3.
    void discardAbandonedDraft(diagnosticLocalId, diagnosticPersistenceRef.current);
    setCapturedImage(null);
    setInferenceResult(null);
    setDiseaseDetails(null);
    setDefensivesList([]);
    setDiagnosticLocalId(null);
    setImageS3Key(null);
    setCrossValidationState('IDLE');
    setCrossValidationResult(null);
    setFeedbackChoice(null);
    setFeedbackSubmitted(false);
    diagnosticPersistenceRef.current = null;
    if (Platform.OS === 'web') startWebcam();
  };

  // Navigation to Chat
  const handleGoToChat = async () => {
    if (!inferenceResult) return;
    try {
      await diagnosticPersistenceRef.current;
    } catch {
      console.warn('[Camera] Opening chat without persisted diagnosis.');
    }
    useChatStore.getState().setDiagnosticContext(
      buildDiagnosticChatContext(
        inferenceResult,
        diseaseDetails?.nome_comum,
        imageS3Key,
        diagnosticLocalId
      )
    );
    router.push('/chat');
  };

  const handleSubmitFeedback = async () => {
    if (!feedbackChoice || feedbackSubmitted) return;
    if (feedbackChoice === 'OTHER' && !correctedDiseaseId) {
      Toast.show({
        type: 'info',
        text1: 'Selecione a doença',
        text2: 'Informe qual doença parece ser a correta.',
      });
      return;
    }

    setIsSubmittingFeedback(true);
    try {
      const localId = diagnosticLocalId ?? (await diagnosticPersistenceRef.current);
      if (!localId) throw new Error('Diagnóstico local ainda não foi persistido.');
      const divergentChoiceNote =
        feedbackChoice === 'LLM' ? 'Produtor escolheu a opinião do Agrônomo IA.' : '';
      await queueDiagnosisFeedback({
        diagnosticLocalId: localId,
        isCorrect: feedbackChoice === 'CORRECT',
        correctedDoencaId:
          feedbackChoice === 'LLM'
            ? crossValidationResult?.llm_doenca_id
            : feedbackChoice === 'OTHER'
              ? correctedDiseaseId
              : null,
        notes: [divergentChoiceNote, feedbackNotes.trim()].filter(Boolean).join(' '),
      });
      setFeedbackSubmitted(true);
      Toast.show({
        type: 'success',
        text1: 'Feedback registrado',
        text2: 'Sua avaliação será sincronizada quando houver conexão.',
      });
    } catch {
      console.error('[Camera] Failed to queue feedback.');
      Toast.show({
        type: 'error',
        text1: 'Erro ao registrar feedback',
        text2: 'Tente novamente em instantes.',
      });
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  // --- RENDERS ---

  // UI state A: Loading inference
  if (isProcessing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.loadingText}>Processando imagem via IA local...</Text>
        <Text style={styles.loadingSubtext}>Processamento estimado em menos de 500ms</Text>
      </View>
    );
  }

  // UI state B: Showing Results (Card de Resultado)
  if (inferenceResult && capturedImage) {
    const isHealthy = inferenceResult.diseaseId === 'Saudável';
    const isPhyto = inferenceResult.diseaseId === 'Fitotoxicidade';
    const crossValidationPriority = crossValidationResult
      ? getCrossValidationPriority(inferenceResult.confidence, crossValidationResult)
      : null;

    // Set severity metrics
    let severityLevel = 1;
    let severityLabel = 'Severidade Baixa';
    let severityBadgeColor: 'success' | 'warning' | 'error' = 'success';

    if (diseaseDetails) {
      severityLevel = diseaseDetails.nivel_severidade;
      if (severityLevel <= 2) {
        severityLabel = 'Severidade Baixa';
        severityBadgeColor = 'success';
      } else if (severityLevel <= 3) {
        severityLabel = 'Severidade Média';
        severityBadgeColor = 'warning';
      } else {
        severityLabel = 'Severidade Alta';
        severityBadgeColor = 'error';
      }
    } else if (isPhyto) {
      severityLabel = 'Fatores Abióticos';
      severityBadgeColor = 'warning';
    }

    return (
      <SafeAreaView style={styles.resultContainer}>
        {/* Upper cover photo */}
        <View style={styles.resultImageContainer}>
          <Image source={{ uri: capturedImage }} style={styles.resultImage} />
          
          <TouchableOpacity 
            style={styles.backButtonOverlay} 
            onPress={handleResetCamera}
            activeOpacity={0.7}
            accessibilityLabel="Voltar para a câmera"
          >
            <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* Overlapping Info sheet */}
        <View style={styles.resultSheet}>
          <View style={styles.sheetHandle} />

          <ScrollView 
            style={styles.sheetScrollContainer}
            contentContainerStyle={styles.sheetScroll}
            showsVerticalScrollIndicator={false}
          >
            {/* Header info */}
            <View style={styles.resultHeader}>
              <View style={styles.headerTitleBlock}>
                <Text style={styles.resultTitle}>
                  {isHealthy 
                    ? 'Nenhuma Doença Detectada' 
                    : isPhyto 
                      ? 'Dano Abiótico / Fitotoxicidade' 
                      : diseaseDetails?.nome_comum || 'Doença não catalogada'}
                </Text>
                
                {(!isHealthy && !isPhyto && diseaseDetails?.nome_cientifico) && (
                  <Text style={styles.resultScientific}>{diseaseDetails.nome_cientifico}</Text>
                )}

                <View style={styles.precisionRow}>
                  <Ionicons name="checkmark-circle" size={16} color={theme.colors.primary} />
                  <Text style={styles.precisionText}>
                    {Math.round(inferenceResult.confidence * 100)}% de precisão da IA
                  </Text>
                </View>
              </View>

              <Badge 
                text={isHealthy ? 'Saudável' : severityLabel} 
                type={severityBadgeColor} 
              />
            </View>

            <View style={styles.divider} />

            {!isHealthy && !isPhyto && crossValidationState === 'LOADING' && (
              <View style={styles.crossValidationLoading}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <Text style={styles.crossValidationLoadingText}>Consultando Agrônomo IA...</Text>
              </View>
            )}

            {!isHealthy && !isPhyto && crossValidationState === 'COMPLETE' && crossValidationResult && (
              <View
                style={[
                  styles.crossValidationCard,
                  crossValidationResult.result_status === 'DIVERGENT' && styles.crossValidationDivergent,
                ]}
              >
                <View style={styles.specialBoxHeader}>
                  <Ionicons
                    name={
                      crossValidationResult.result_status === 'DIVERGENT'
                        ? 'warning-outline'
                        : crossValidationResult.result_status === 'ENRICHED'
                          ? 'bulb-outline'
                          : 'checkmark-circle-outline'
                    }
                    size={22}
                    color={
                      crossValidationResult.result_status === 'DIVERGENT'
                        ? theme.colors.warning
                        : theme.colors.primary
                    }
                  />
                  <Text style={styles.crossValidationTitle}>
                    {crossValidationResult.result_status === 'CONFIRMED'
                      ? 'Diagnóstico confirmado'
                      : crossValidationResult.result_status === 'ENRICHED'
                        ? 'Diagnóstico enriquecido'
                        : 'As análises divergiram'}
                  </Text>
                </View>

                {crossValidationResult.result_status === 'DIVERGENT' && (
                  <View style={styles.divergentOpinions}>
                    <Text style={styles.opinionText}>
                      🔬 Modelo local: {diseaseDetails?.nome_comum ?? 'doença identificada'} ({Math.round(inferenceResult.confidence * 100)}%)
                      {crossValidationPriority?.primary === 'CV' ? ' • resultado primário' : ''}
                    </Text>
                    <Text style={styles.opinionText}>
                      ☁️ Agrônomo IA: {crossValidationResult.llm_doenca_nome ?? 'outra hipótese'} ({Math.round(crossValidationResult.llm_confianca * 100)}%)
                      {crossValidationPriority?.primary === 'LLM' ? ' • sugestão primária' : ''}
                    </Text>
                    <Text style={styles.divergenceWarning}>
                      As duas opiniões permanecem visíveis. Consulte um engenheiro agrônomo para confirmar.
                    </Text>
                  </View>
                )}

                <Text style={styles.crossValidationObservations}>
                  {crossValidationResult.llm_observacoes}
                </Text>
              </View>
            )}

            {!isHealthy && !isPhyto && crossValidationState === 'UNAVAILABLE' && (
              <View style={styles.crossValidationUnavailable}>
                <Ionicons name="cloud-offline-outline" size={18} color={theme.colors.textSecondary} />
                <Text style={styles.crossValidationUnavailableText}>
                  Segunda opinião indisponível. O diagnóstico local continua válido e acessível.
                </Text>
              </View>
            )}

            {/* Case 1: Healthy */}
            {isHealthy && (
              <View style={styles.specialResultBox}>
                <View style={styles.specialBoxHeader}>
                  <Ionicons name="leaf-outline" size={24} color={theme.colors.primary} />
                  <Text style={styles.specialBoxTitle}>Planta Saudável</Text>
                </View>
                <Text style={styles.specialBoxText}>
                  A folha escaneada apresenta características normais e não foi identificada nenhuma lesão por ferrugem ou mancha alvo. Continue acompanhando e monitorando periodicamente a lavoura.
                </Text>
              </View>
            )}

            {/* Case 2: Phytotoxicity */}
            {isPhyto && (
              <View style={[styles.specialResultBox, { borderColor: theme.colors.warning, backgroundColor: 'rgba(245, 124, 0, 0.08)' }]}>
                <View style={styles.specialBoxHeader}>
                  <Ionicons name="warning-outline" size={24} color={theme.colors.warning} />
                  <Text style={[styles.specialBoxTitle, { color: theme.colors.warning }]}>Fitotoxicidade Detectada</Text>
                </View>
                <Text style={styles.specialBoxText}>
                  Detectamos lesões que indicam queimadura de pontas, danos fitotóxicos abióticos (pelo uso equivocado de misturas ou dosagens de defensivos químicos) ou estresse ambiental da planta. 
                  {'\n\n'}
                  <Text style={{ fontWeight: 'bold' }}>Recomendação:</Text> Não aplique defensivos químicos fungicidas adicionais. Consulte um engenheiro agrônomo para averiguar o manejo de defensivos anteriores ou sintomas de estresse hídrico.
                </Text>
              </View>
            )}

            {/* Case 3: Diseased */}
            {!isHealthy && !isPhyto && (
              <View>
                {/* Agent Causa section */}
                {diseaseDetails?.causa && (
                  <View style={styles.infoSection}>
                    <View style={styles.sectionTitleRow}>
                      <Ionicons name="bug-outline" size={20} color={theme.colors.text} style={styles.sectionIcon} />
                      <Text style={styles.sectionTitle}>Agente Causal</Text>
                    </View>
                    <Text style={styles.sectionBody}>{diseaseDetails.causa}</Text>
                  </View>
                )}

                {/* Symptoms section */}
                <View style={styles.infoSection}>
                  <View style={styles.sectionTitleRow}>
                    <Ionicons name="alert-circle-outline" size={20} color={theme.colors.text} style={styles.sectionIcon} />
                    <Text style={styles.sectionTitle}>Sintomas Característicos</Text>
                  </View>
                  <Text style={styles.sectionBody}>{diseaseDetails?.sintomas || 'Sintomas não documentados localmente.'}</Text>
                </View>

                {/* Treatment section */}
                <View style={styles.infoSection}>
                  <View style={styles.sectionTitleRow}>
                    <Ionicons name="medical-outline" size={20} color={theme.colors.text} style={styles.sectionIcon} />
                    <Text style={styles.sectionTitle}>Tratamentos Recomendados</Text>
                  </View>
                  
                  {defensivesList.length === 0 ? (
                    <Text style={styles.emptyDefensivesText}>Não há produtos químicos recomendados catalogados no SQLite.</Text>
                  ) : (
                    defensivesList.map((item) => {
                      let parsedBula: any = null;
                      try {
                        if (item.bula_resumida && item.bula_resumida.startsWith('{')) {
                          parsedBula = JSON.parse(item.bula_resumida);
                        }
                      } catch {
                        console.error('Failed to parse bula_resumida JSON.');
                      }

                      return (
                        <View key={item.id} style={styles.defensiveCard}>
                          <View style={styles.defensiveHeader}>
                            <Text style={styles.defensiveName}>{item.nome_comercial}</Text>
                            <Text style={styles.defensiveClass}>{item.classe}</Text>
                          </View>
                          
                          <View style={styles.defensiveDetailRow}>
                            <Text style={styles.defensiveLabel}>Ingrediente Ativo:</Text>
                            <Text style={styles.defensiveValue}>{item.ingrediente_ativo}</Text>
                          </View>

                          {item.grupo_quimico_frac ? (
                            <View style={styles.defensiveDetailRow}>
                              <Text style={styles.defensiveLabel}>Grupo FRAC:</Text>
                              <Text style={styles.defensiveValue}>{item.grupo_quimico_frac}</Text>
                            </View>
                          ) : null}

                          <View style={styles.defensiveDetailRow}>
                            <Text style={styles.defensiveLabel}>Dosagem:</Text>
                            <Text style={styles.defensiveValue}>{item.dosagem_recomendada}</Text>
                          </View>

                          <View style={styles.defensiveDetailRow}>
                            <Text style={styles.defensiveLabel}>Carência:</Text>
                            <Text style={styles.defensiveValue}>{item.carencia_dias} dias</Text>
                          </View>

                          {item.max_aplicacoes_ciclo > 0 && (
                            <View style={styles.defensiveDetailRow}>
                              <Text style={styles.defensiveLabel}>Máx. Aplicações:</Text>
                              <Text style={styles.defensiveValue}>{item.max_aplicacoes_ciclo}x por ciclo</Text>
                            </View>
                          )}

                          {parsedBula ? (
                            <View style={{ marginTop: 8 }}>
                              <Text style={styles.bulaHeader}>Modo de Ação:</Text>
                              <Text style={styles.bulaText}>{parsedBula.modo_de_acao}</Text>

                              <Text style={styles.bulaHeader}>Época de Aplicação:</Text>
                              <Text style={styles.bulaText}>{parsedBula.epoca_aplicacao}</Text>

                              <Text style={styles.bulaHeader}>Volume de Calda:</Text>
                              <Text style={styles.bulaText}>{parsedBula.volume_calda}</Text>

                              {parsedBula.epis_exigidos && parsedBula.epis_exigidos.length > 0 && (
                                <>
                                  <Text style={styles.bulaHeader}>EPIs Necessários:</Text>
                                  <Text style={styles.bulaText}>{parsedBula.epis_exigidos.join(', ')}</Text>
                                </>
                              )}

                              {parsedBula.restricoes_ambientais && (
                                <>
                                  <Text style={styles.bulaHeader}>Restrições Ambientais:</Text>
                                  <Text style={styles.bulaText}>{parsedBula.restricoes_ambientais}</Text>
                                </>
                              )}
                            </View>
                          ) : (
                            <>
                              <Text style={styles.bulaHeader}>Resumo de Bula/Aplicação:</Text>
                              <Text style={styles.bulaText}>{item.bula_resumida}</Text>
                            </>
                          )}
                        </View>
                      );
                    })
                  )}
                </View>

                {/* Mandatory Disclaimer */}
                <View style={styles.disclaimerContainer}>
                  <Ionicons name="information-circle" size={22} color={theme.colors.error} style={{ marginRight: 8, marginTop: 2 }} />
                  <Text style={styles.disclaimerText}>
                    ATENÇÃO: Produto indicado apenas para uso agrícola. Venda sob receita agronômica. Consulte sempre um engenheiro agrônomo. (Lei 7.802/1989)
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.feedbackSection}>
              <Text style={styles.sectionTitle}>Este diagnóstico parece correto?</Text>
              {feedbackSubmitted ? (
                <View style={styles.feedbackSuccess}>
                  <Ionicons name="checkmark-circle" size={20} color={theme.colors.primary} />
                  <Text style={styles.feedbackSuccessText}>Feedback salvo para sincronização.</Text>
                </View>
              ) : (
                <>
                  <View style={styles.feedbackButtons}>
                    <TouchableOpacity
                      style={[styles.feedbackButton, feedbackChoice === 'CORRECT' && styles.feedbackButtonSelected]}
                      onPress={() => {
                        setFeedbackChoice('CORRECT');
                        setCorrectedDiseaseId(null);
                      }}
                    >
                      <Text style={styles.feedbackButtonText}>
                        {crossValidationResult?.result_status === 'DIVERGENT'
                          ? `É ${diseaseDetails?.nome_comum ?? 'a opinião local'}`
                          : 'Diagnóstico correto'}
                      </Text>
                    </TouchableOpacity>

                    {crossValidationResult?.result_status === 'DIVERGENT' ? (
                      <TouchableOpacity
                        style={[styles.feedbackButton, feedbackChoice === 'LLM' && styles.feedbackButtonSelected]}
                        onPress={() => {
                          setFeedbackChoice('LLM');
                          setCorrectedDiseaseId(crossValidationResult.llm_doenca_id);
                        }}
                      >
                        <Text style={styles.feedbackButtonText}>
                          É {crossValidationResult.llm_doenca_nome ?? 'a opinião do Agrônomo IA'}
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[styles.feedbackButton, feedbackChoice === 'INCORRECT' && styles.feedbackButtonSelected]}
                        onPress={() => {
                          setFeedbackChoice('INCORRECT');
                          setCorrectedDiseaseId(null);
                        }}
                      >
                        <Text style={styles.feedbackButtonText}>Incorreto</Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      style={[styles.feedbackButton, feedbackChoice === 'OTHER' && styles.feedbackButtonSelected]}
                      onPress={() => setFeedbackChoice('OTHER')}
                    >
                      <Text style={styles.feedbackButtonText}>Parece ser outra doença</Text>
                    </TouchableOpacity>
                  </View>

                  {feedbackChoice === 'OTHER' && (
                    <View style={styles.diseasePicker}>
                      <Text style={styles.feedbackLabel}>Selecione a correção:</Text>
                      {feedbackDiseases.map((disease) => (
                        <TouchableOpacity
                          key={disease.id}
                          style={[
                            styles.diseaseOption,
                            correctedDiseaseId === disease.id && styles.diseaseOptionSelected,
                          ]}
                          onPress={() => setCorrectedDiseaseId(disease.id)}
                        >
                          <Text style={styles.diseaseOptionText}>{disease.nome_comum}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  {feedbackChoice && (
                    <>
                      <TextInput
                        style={styles.feedbackNotesInput}
                        value={feedbackNotes}
                        onChangeText={setFeedbackNotes}
                        placeholder="Observações (opcional)"
                        placeholderTextColor={theme.colors.textSecondary}
                        multiline
                      />
                      <Button
                        title="Enviar feedback"
                        onPress={handleSubmitFeedback}
                        loading={isSubmittingFeedback}
                        disabled={!diagnosticLocalId}
                        variant="secondary"
                        style={styles.feedbackSubmitButton}
                      />
                    </>
                  )}
                </>
              )}
            </View>

            {/* Geolocation metadata */}
            <View style={styles.locationMetadata}>
              <Ionicons name="pin" size={12} color={theme.colors.textSecondary} />
              <Text style={styles.locationMetadataText}>
                Coordenadas: {gpsLocation?.latitude.toFixed(6)}, {gpsLocation?.longitude.toFixed(6)} • Modelo: {inferenceResult.modelUsed}
              </Text>
            </View>
          </ScrollView>

          {/* Fixed Actions Footer outside of scroll per spec */}
          <View style={styles.sheetButtonsContainer}>
            <Button
              title="Conversar com o Agrônomo"
              onPress={handleGoToChat}
              variant="primary"
              disabled={!diagnosticLocalId}
              style={styles.actionBtnPrimary}
              icon={<Ionicons name="chatbubbles-outline" size={20} color="#FFFFFF" />}
              iconPosition="right"
            />
            <TouchableOpacity
              style={styles.actionBtnSecondary}
              onPress={handleSaveToHistory}
              disabled={!diagnosticLocalId}
              activeOpacity={0.7}
              accessibilityLabel="Salvar no Histórico"
            >
              <Text style={styles.actionBtnSecondaryText}>Salvar no Histórico</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // UI state C: Camera Viewfinder (Normal View)
  const renderViewfinder = () => {
    if (Platform.OS === 'web') {
      return (
        <View style={styles.viewfinderContainer}>
          <video
            ref={webVideoRef}
            autoPlay
            playsInline
            muted
            style={{ ...(styles.webVideo as object), objectFit: 'cover' } as React.CSSProperties}
          />
        </View>
      );
    }

    if (!hasNativePermission) {
      return (
        <View style={styles.permissionFallback}>
          <Ionicons name="camera-reverse-outline" size={64} color={theme.colors.textSecondary} />
          <Text style={styles.permissionTextTitle}>Permissão de Câmera</Text>
          <Text style={styles.permissionTextDesc}>
            Para utilizar a câmera local de inferência do dispositivo, conceda a permissão nativa.
          </Text>
          <Button
            title="Conceder Permissão"
            onPress={requestNativePermission}
            variant="primary"
            style={{ marginTop: theme.spacing.md }}
          />
        </View>
      );
    }

    if (!nativeDevice || !NativeCamera) {
      return (
        <View style={styles.permissionFallback}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.permissionTextDesc}>Carregando sensor de câmera traseira...</Text>
        </View>
      );
    }

    return (
      <View style={styles.viewfinderContainer}>
        <NativeCamera
          ref={nativeCameraRef}
          style={StyleSheet.absoluteFill}
          device={nativeDevice}
          isActive={true}
          photo={true}
        />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Top action bar (Flash moved to bottom control bar) */}
      <View style={styles.topActionsBar}>
        <TouchableOpacity 
          style={styles.circleBtn} 
          onPress={() => router.replace('/')}
          activeOpacity={0.7}
          accessibilityLabel="Fechar câmera e voltar para a tela inicial"
        >
          <Ionicons name="close" size={24} color="#FFFFFF" />
        </TouchableOpacity>

        {/* Debug Panel Toggle (Only in DEV / Web) */}
        {(__DEV__ || Platform.OS === 'web') && (
          <TouchableOpacity 
            style={[styles.circleBtn, showDebugPanel && { backgroundColor: theme.colors.primary }]}
            onPress={() => setShowDebugPanel(!showDebugPanel)}
            activeOpacity={0.7}
            accessibilityLabel="Abrir simulador de diagnóstico para testes"
          >
            <Ionicons name="bug-outline" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        )}
      </View>

      {/* Network Sensing Offline Banner */}
      {(connectionMode === 'FIELD' || connectionMode === 'DEGRADED') && (
        <View style={styles.offlineBadgeContainer}>
          <View style={[styles.offlineBadge, connectionMode === 'DEGRADED' && { borderColor: 'rgba(245, 124, 0, 0.4)' }]}>
            <Ionicons 
              name={connectionMode === 'FIELD' ? 'cloud-offline' : 'warning-outline'} 
              size={16} 
              color="#FFFFFF" 
              style={{ marginRight: 6 }} 
            />
            <Text style={styles.offlineBadgeText}>
              {connectionMode === 'FIELD' ? 'Modo Offline Ativo' : 'Conexão Instável'}
            </Text>
          </View>
        </View>
      )}

      {/* Viewfinder frame */}
      <View style={styles.cameraBox}>
        {renderViewfinder()}

        {/* Viewfinder brackets box */}
        <View style={styles.bracketsContainer}>
          <View style={styles.bracketOverlayTop}>
            <Text style={styles.instructionsText}>Centralize a folha doente aqui</Text>
          </View>

          <View style={styles.bracketRow}>
            {/* Upper Left Corner */}
            <View style={[styles.bracketCorner, styles.bracketTopLeft]} />
            <View style={{ flex: 1 }} />
            {/* Upper Right Corner */}
            <View style={[styles.bracketCorner, styles.bracketTopRight]} />
          </View>

          <View style={{ flex: 1 }} />

          <View style={styles.bracketRow}>
            {/* Lower Left Corner */}
            <View style={[styles.bracketCorner, styles.bracketBottomLeft]} />
            <View style={{ flex: 1 }} />
            {/* Lower Right Corner */}
            <View style={[styles.bracketCorner, styles.bracketBottomRight]} />
          </View>
          
          <View style={styles.bracketOverlayBottom} />
        </View>
      </View>

      {/* Captures layout controls */}
      <View style={styles.bottomControlContainer}>
        {/* Gallery button (Left) */}
        <TouchableOpacity 
          style={styles.accessoryBtn} 
          onPress={handlePickFromGallery}
          activeOpacity={0.7}
          accessibilityLabel="Abrir galeria de fotos"
        >
          <Ionicons name="images-outline" size={24} color="#FFFFFF" />
        </TouchableOpacity>

        {/* Large Shutter Button (Center) */}
        <TouchableOpacity 
          style={styles.shutterBtnOutline}
          onPress={handleCapturePhoto}
          activeOpacity={0.8}
          accessibilityLabel="Tirar foto para diagnóstico"
        >
          <View style={styles.shutterBtnInner}>
            <Ionicons name="camera" size={28} color="#FFFFFF" />
          </View>
        </TouchableOpacity>

        {/* Flash button (Right, replaces Spacer on Native) */}
        {Platform.OS !== 'web' && hasNativePermission && nativeDevice ? (
          <TouchableOpacity 
            style={styles.accessoryBtn} 
            onPress={handleToggleFlash}
            activeOpacity={0.7}
            accessibilityLabel="Alternar flash da câmera"
          >
            <Ionicons 
              name={flashMode === 'on' ? 'flash' : 'flash-off'} 
              size={24} 
              color="#FFFFFF" 
            />
          </TouchableOpacity>
        ) : (
          <View style={styles.accessoryBtnSpacer} />
        )}
      </View>

      {/* Fixed Navigation Tab Bar */}
      <View style={styles.bottomTabBar}>
        <TouchableOpacity
          style={styles.bottomTabItemActive}
          activeOpacity={1}
          accessibilityRole="tab"
          accessibilityState={{ selected: true }}
          accessibilityLabel="Câmera, aba atual"
        >
          <Ionicons name="camera" size={24} color={theme.colors.primary} />
          <Text style={styles.bottomTabLabelActive}>Câmera</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.bottomTabItem} 
          onPress={() => router.push('/chat')}
          activeOpacity={0.7}
          accessibilityRole="tab"
          accessibilityLabel="Abrir chat com agrônomo"
        >
          <Ionicons name="chatbubbles-outline" size={24} color={theme.colors.textSecondary} />
          <Text style={styles.bottomTabLabel}>Chat</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.bottomTabItem} 
          onPress={() => router.replace('/')}
          activeOpacity={0.7}
          accessibilityRole="tab"
          accessibilityLabel="Abrir catálogo"
        >
          <Ionicons name="book-outline" size={24} color={theme.colors.textSecondary} />
          <Text style={styles.bottomTabLabel}>Catálogo</Text>
        </TouchableOpacity>
      </View>

      {/* Development Debug Overlay Panel */}
      <Modal
        visible={showDebugPanel}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowDebugPanel(false)}
      >
        <View style={styles.debugModalOverlay}>
          <View style={styles.debugPanel}>
            <View style={styles.debugHeader}>
              <Text style={styles.debugTitle}>Simulador de Diagnóstico (Debug)</Text>
              <TouchableOpacity onPress={() => setShowDebugPanel(false)}>
                <Ionicons name="close-circle" size={28} color={theme.colors.text} />
              </TouchableOpacity>
            </View>
            
            <Text style={styles.debugDesc}>
              Selecione qual resultado você deseja forçar para testar o comportamento do aplicativo nas diferentes condições da Sprint 3:
            </Text>

            <TouchableOpacity 
              style={[styles.debugOptionBtn, { borderLeftColor: theme.colors.error }]}
              onPress={() => {
                setShowDebugPanel(false);
                processDiagnostic(LOCAL_MOCK_IMAGE_BASE64, '3f34559c-6a12-4eb2-a42e-cf629ec2e9e6'); // Ferrugem Asiática
              }}
            >
              <Ionicons name="bug" size={20} color={theme.colors.error} style={{ marginRight: 8 }} />
              <Text style={styles.debugOptionText}>Ferrugem Asiática (Doença)</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.debugOptionBtn, { borderLeftColor: theme.colors.error }]}
              onPress={() => {
                setShowDebugPanel(false);
                processDiagnostic(LOCAL_MOCK_IMAGE_BASE64, '5be520ca-a6fc-46cd-ae38-fc62157a44f1'); // Mancha Alvo
              }}
            >
              <Ionicons name="bug" size={20} color={theme.colors.error} style={{ marginRight: 8 }} />
              <Text style={styles.debugOptionText}>Mancha Alvo (Doença)</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.debugOptionBtn, { borderLeftColor: theme.colors.error }]}
              onPress={() => {
                setShowDebugPanel(false);
                processDiagnostic(LOCAL_MOCK_IMAGE_BASE64, '1d1c8f61-e0ad-4670-b74d-5c0a8f89e49a'); // Antracnose
              }}
            >
              <Ionicons name="bug" size={20} color={theme.colors.error} style={{ marginRight: 8 }} />
              <Text style={styles.debugOptionText}>Antracnose (Nova Doença)</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.debugOptionBtn, { borderLeftColor: theme.colors.primary }]}
              onPress={() => {
                setShowDebugPanel(false);
                processDiagnostic(LOCAL_MOCK_IMAGE_BASE64, 'Saudável');
              }}
            >
              <Ionicons name="checkmark-circle" size={20} color={theme.colors.primary} style={{ marginRight: 8 }} />
              <Text style={styles.debugOptionText}>Planta Saudável (Sem Defensivos)</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.debugOptionBtn, { borderLeftColor: theme.colors.warning }]}
              onPress={() => {
                setShowDebugPanel(false);
                processDiagnostic(LOCAL_MOCK_IMAGE_BASE64, 'Fitotoxicidade');
              }}
            >
              <Ionicons name="warning" size={20} color={theme.colors.warning} style={{ marginRight: 8 }} />
              <Text style={styles.debugOptionText}>Fitotoxicidade / Queimadura (Sem Defensivos)</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000', // Black background for viewfinder aesthetics
  },
  topActionsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    paddingTop: Platform.OS === 'ios' ? 10 : 20,
    zIndex: 10,
    position: 'absolute',
    left: 0,
    right: 0,
  },
  circleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  offlineBadgeContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 64 : 74,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 100,
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  offlineBadgeText: {
    color: '#FFFFFF',
    fontSize: theme.typography.fontSize.xs,
    fontWeight: 'bold',
  },
  cameraBox: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#000000',
  },
  viewfinderContainer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000000',
  },
  webVideo: {
    width: '100%',
    height: '100%',
  },
  permissionFallback: {
    flex: 1,
    backgroundColor: '#1C1C1E',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.xl,
  },
  permissionTextTitle: {
    color: '#FFFFFF',
    fontSize: theme.typography.fontSize.lg,
    fontWeight: 'bold',
    marginTop: theme.spacing.md,
    textAlign: 'center',
  },
  permissionTextDesc: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.fontSize.sm,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  bracketsContainer: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
    padding: 30,
    zIndex: 5,
  },
  bracketOverlayTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120, // fixed upper overlay
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 15,
  },
  bracketOverlayBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 120, // fixed lower overlay
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  instructionsText: {
    color: '#FFFFFF',
    fontSize: theme.typography.fontSize.sm + 1,
    fontWeight: '500',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 100,
    overflow: 'hidden',
  },
  bracketRow: {
    flexDirection: 'row',
    height: 40,
    zIndex: 6,
  },
  bracketCorner: {
    width: 40,
    height: 40,
    borderColor: '#FFFFFF',
    borderWidth: 5,
  },
  bracketTopLeft: {
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderTopLeftRadius: 12,
  },
  bracketTopRight: {
    borderLeftWidth: 0,
    borderBottomWidth: 0,
    borderTopRightRadius: 12,
  },
  bracketBottomLeft: {
    borderRightWidth: 0,
    borderTopWidth: 0,
    borderBottomLeftRadius: 12,
  },
  bracketBottomRight: {
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderBottomRightRadius: 12,
  },
  bottomControlContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl + 10,
    position: 'absolute',
    bottom: 84,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  shutterBtnOutline: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  shutterBtnInner: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  accessoryBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  accessoryBtnSpacer: {
    width: 48,
  },
  bottomTabBar: {
    flexDirection: 'row',
    height: 64,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingBottom: Platform.OS === 'ios' ? 12 : 4,
    zIndex: 10,
  },
  bottomTabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    height: '100%',
  },
  bottomTabItemActive: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    height: '100%',
  },
  bottomTabLabel: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    marginTop: 3,
  },
  bottomTabLabelActive: {
    fontSize: 11,
    color: theme.colors.primary,
    fontWeight: 'bold',
    marginTop: 3,
  },

  // LOADING STATE
  loadingContainer: {
    flex: 1,
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.xl,
  },
  loadingText: {
    marginTop: theme.spacing.md,
    fontSize: theme.typography.fontSize.md,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  loadingSubtext: {
    marginTop: 6,
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textSecondary,
  },

  // RESULTS BOTTOM SHEET VIEW
  resultContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  resultImageContainer: {
    height: 250, // fixed cover height
    width: '100%',
    position: 'relative',
  },
  resultImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  backButtonOverlay: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 12 : 24,
    left: theme.spacing.md,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultSheet: {
    flex: 1,
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -24,
    overflow: 'hidden',
  },
  sheetHandle: {
    width: 40,
    height: 5,
    backgroundColor: '#D1D1D6',
    borderRadius: 3,
    alignSelf: 'center',
    marginVertical: 10,
  },
  sheetScrollContainer: {
    flex: 1,
  },
  sheetScroll: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: 24,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: theme.spacing.sm,
  },
  headerTitleBlock: {
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  resultTitle: {
    fontSize: theme.typography.fontSize.xl + 2,
    fontWeight: 'bold',
    color: theme.colors.text,
    lineHeight: 30,
  },
  resultScientific: {
    fontSize: theme.typography.fontSize.sm,
    fontStyle: 'italic',
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  precisionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  precisionText: {
    fontSize: theme.typography.fontSize.xs + 1,
    color: theme.colors.textSecondary,
    marginLeft: 4,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: theme.spacing.md,
  },
  specialResultBox: {
    borderWidth: 1.5,
    borderColor: theme.colors.primary,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.primaryLight10,
    marginBottom: theme.spacing.md,
  },
  specialBoxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  specialBoxTitle: {
    fontSize: theme.typography.fontSize.md,
    fontWeight: 'bold',
    color: theme.colors.primary,
    marginLeft: 8,
  },
  specialBoxText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text,
    lineHeight: 20,
  },
  infoSection: {
    marginBottom: theme.spacing.lg,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionIcon: {
    marginRight: 6,
  },
  sectionTitle: {
    fontSize: theme.typography.fontSize.md,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  sectionBody: {
    fontSize: theme.typography.fontSize.sm + 1,
    color: theme.colors.textSecondary,
    lineHeight: 22,
  },
  emptyDefensivesText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
    fontStyle: 'italic',
    marginTop: 4,
  },
  defensiveCard: {
    backgroundColor: theme.colors.surfaceLight,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  defensiveHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  defensiveName: {
    fontSize: theme.typography.fontSize.md,
    fontWeight: 'bold',
    color: theme.colors.primaryDark,
  },
  defensiveClass: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textSecondary,
    backgroundColor: theme.colors.border,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  defensiveDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  defensiveLabel: {
    fontSize: theme.typography.fontSize.xs + 1,
    color: theme.colors.textSecondary,
  },
  defensiveValue: {
    fontSize: theme.typography.fontSize.xs + 1,
    fontWeight: '600',
    color: theme.colors.text,
  },
  bulaHeader: {
    fontSize: theme.typography.fontSize.xs + 1,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginTop: 10,
    marginBottom: 4,
  },
  bulaText: {
    fontSize: theme.typography.fontSize.xs + 1,
    color: theme.colors.textSecondary,
    lineHeight: 18,
  },
  disclaimerContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(211, 47, 47, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(211, 47, 47, 0.25)',
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  disclaimerText: {
    flex: 1,
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.error,
    fontWeight: 'bold',
    lineHeight: 16,
  },
  crossValidationLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.primaryLight10,
    marginBottom: theme.spacing.md,
  },
  crossValidationLoadingText: {
    marginLeft: theme.spacing.sm,
    color: theme.colors.primaryDark,
    fontWeight: '600',
  },
  crossValidationCard: {
    borderWidth: 1.5,
    borderColor: theme.colors.primary,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.primaryLight10,
    marginBottom: theme.spacing.md,
  },
  crossValidationDivergent: {
    borderColor: theme.colors.warning,
    backgroundColor: 'rgba(245, 124, 0, 0.08)',
  },
  crossValidationTitle: {
    marginLeft: theme.spacing.sm,
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.md,
    fontWeight: 'bold',
  },
  divergentOpinions: {
    gap: 8,
    marginBottom: theme.spacing.sm,
  },
  opinionText: {
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.sm,
    lineHeight: 20,
  },
  divergenceWarning: {
    color: theme.colors.warning,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: 'bold',
    lineHeight: 20,
  },
  crossValidationObservations: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.fontSize.sm,
    lineHeight: 21,
  },
  crossValidationUnavailable: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.md,
  },
  crossValidationUnavailableText: {
    flex: 1,
    marginLeft: theme.spacing.sm,
    color: theme.colors.textSecondary,
    fontSize: theme.typography.fontSize.sm,
  },
  feedbackSection: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.lg,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
  },
  feedbackButtons: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  feedbackButton: {
    borderWidth: 1,
    borderColor: theme.colors.borderOutline,
    borderRadius: theme.borderRadius.md,
    paddingVertical: 12,
    paddingHorizontal: theme.spacing.md,
  },
  feedbackButtonSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primaryLight10,
  },
  feedbackButtonText: {
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
  diseasePicker: {
    marginTop: theme.spacing.md,
    gap: 6,
  },
  feedbackLabel: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    marginBottom: 4,
  },
  diseaseOption: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.sm,
    padding: 10,
  },
  diseaseOptionSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primaryLight10,
  },
  diseaseOptionText: {
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.sm,
  },
  feedbackNotesInput: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: theme.colors.borderOutline,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginTop: theme.spacing.md,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
    textAlignVertical: 'top',
  },
  feedbackSubmitButton: {
    marginTop: theme.spacing.md,
  },
  feedbackSuccess: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.spacing.md,
  },
  feedbackSuccessText: {
    marginLeft: theme.spacing.sm,
    color: theme.colors.primaryDark,
    fontWeight: '600',
  },
  locationMetadata: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  locationMetadataText: {
    fontSize: theme.typography.fontSize.xxs + 1,
    color: theme.colors.textSecondary,
    marginLeft: 4,
  },
  sheetButtonsContainer: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? 24 : theme.spacing.md,
    backgroundColor: theme.colors.background,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: theme.spacing.md,
  },
  actionBtnPrimary: {
    height: 60,
    borderRadius: 100,
  },
  actionBtnSecondary: {
    height: 60,
    borderRadius: 100,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  actionBtnSecondaryText: {
    fontSize: theme.typography.fontSize.md,
    fontWeight: 'bold',
    color: theme.colors.primary,
  },

  // DEBUG SELECT MODAL
  debugModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  debugPanel: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: theme.spacing.md,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
  },
  debugHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  debugTitle: {
    fontSize: theme.typography.fontSize.md + 2,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  debugDesc: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.md,
    lineHeight: 20,
  },
  debugOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.md,
    backgroundColor: '#F5F5F5',
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.sm,
    borderLeftWidth: 4,
  },
  debugOptionText: {
    fontSize: theme.typography.fontSize.sm + 1,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
});
