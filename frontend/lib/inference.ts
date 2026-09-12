import { loadTensorflowModel } from 'react-native-fast-tflite';
import * as ImageManipulator from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';
import { Buffer } from 'buffer';
import modelAsset from '../assets/models/model.tflite';

export interface InferenceResult {
  diseaseId: string;
  confidence: number;
  inferenceTimeMs: number;
  modelUsed: string;
}

// Map Azure Custom Vision output labels to local Database ID / UI Tag categories (using seed UUIDs)
export const LABELS_MAP: { [key: string]: string } = {
  'Antracnose': '1d1c8f61-e0ad-4670-b74d-5c0a8f89e49a',
  'Crestamento Bacteriano': 'f3b9c8b7-8db1-4e78-9e53-61a06a6b5791',
  'Crestamento Cercospora': 'e8b8495a-27d1-4475-acb2-2e8c2a39dfa4',
  'Falso Carvão': '136a8360-311a-4d78-b19e-4c07b66df2af',
  'Ferrugem': '3f34559c-6a12-4eb2-a42e-cf629ec2e9e6',
  'Fitotoxicidade de Cobre': 'Fitotoxicidade', // Special layout/no-db category
  'Folha Carijo': '53cbaab1-9b16-444a-89a3-98db25439a37',
  'Mancha Alvo': '5be520ca-a6fc-46cd-ae38-fc62157a44f1',
  'Mancha Mirotécio': '8a6d4d16-728b-4fc8-9f33-722c8369ecdb',
  'Mancha Olho de Rã': '57303e87-6e54-4a4b-ba75-0e31828bd5dc',
  'Mela': 'e2e1e35a-4b68-45a8-ba76-2e88220f4c02',
  'Míldio': '6ac3fdf6-5573-455b-bf8b-ec35d4f3e3a9',
  'Murcha Esclerócio': 'bf7960fc-5b32-45e0-9ef9-cc4d010bb9e9', // Maps to Mofo Branco in database
  'Oídio': '2d1b0638-3486-4f36-be55-b4722513f56f',
  'Podridão Phytophthora': '2b1897e9-e31d-400f-8f83-b09e25d2c20a', // Maps to Podridão Radicular in database
  'Saudável': 'Saudável',
  'Septoria': 'cfbdce3c-ebc4-4bcf-a541-e940b5fa0b46' // Maps to Mancha Parda in database
};

// Raw labels array aligned with labels.txt indexes
export const LABELS_LIST = [
  'Antracnose',
  'Crestamento Bacteriano',
  'Crestamento Cercospora',
  'Falso Carvão',
  'Ferrugem',
  'Fitotoxicidade de Cobre',
  'Folha Carijo',
  'Mancha Alvo',
  'Mancha Mirotécio',
  'Mancha Olho de Rã',
  'Mela',
  'Míldio',
  'Murcha Esclerócio',
  'Oídio',
  'Podridão Phytophthora',
  'Saudável',
  'Septoria'
];

/**
 * Executes a real local AI inference on a plant image using react-native-fast-tflite
 * to load and run model.tflite on the device.
 *
 * @param imageUri Image source URI (local file path or data URI).
 * @param forcedMode Optional override to force a specific result (useful for testing and debug controls).
 */
let _cachedNativeModel: any = null;

export async function runImageInference(
  imageUri: string,
  forcedMode?: string
): Promise<InferenceResult> {
  const startTime = Date.now();

  // 1. If a forced override is provided, respect it (great for testing)
  if (forcedMode) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return {
      diseaseId: forcedMode,
      confidence: parseFloat((0.85 + Math.random() * 0.14).toFixed(2)),
      inferenceTimeMs: Date.now() - startTime,
      modelUsed: 'tflite_mock_mobile_forced_v1.0',
    };
  }

  // 2. Native Mobile Flow (Real Computer Vision Pipeline)
  try {
    // A. Load the model.tflite file from assets (cached — loaded once per session)
    if (!_cachedNativeModel) {
      _cachedNativeModel = await loadTensorflowModel(modelAsset, []);
      console.log('[Inference] TFLite model loaded and cached for this session.');
    }
    const model = _cachedNativeModel;

    // B. Preprocessing Step 1: Resize image to 300x300 and convert to base64
    const manipulated = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: 300, height: 300 } }],
      { format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );

    // C. Preprocessing Step 2: Decode base64 to raw RGBA pixel data
    if (!manipulated.base64) {
      throw new Error('A imagem redimensionada não retornou dados base64.');
    }
    const buffer = Buffer.from(manipulated.base64, 'base64');
    const rawImageData = jpeg.decode(buffer, { useTArray: true });
    
    if (!rawImageData || !rawImageData.data) {
      throw new Error('Falha ao decodificar os pixels da imagem processada.');
    }

    // D. Preprocessing Step 3: Extract R, G, B and normalize to [0.0, 1.0] (Normalized_0_1 mode)
    const floatBuffer = new Float32Array(300 * 300 * 3);
    const rawData = rawImageData.data;
    for (let i = 0, j = 0; i < rawData.length; i += 4, j += 3) {
      floatBuffer[j] = rawData[i] / 255.0;       // Red
      floatBuffer[j + 1] = rawData[i + 1] / 255.0;   // Green
      floatBuffer[j + 2] = rawData[i + 2] / 255.0;   // Blue
    }

    // E. Execute inference on local model
    const outputs = await model.run([floatBuffer]);
    if (!outputs || outputs.length === 0) {
      throw new Error('O modelo não retornou probabilidades de classificação.');
    }

    const probabilities = outputs[0] as Float32Array;

    // F. Postprocessing: Argmax (find highest probability class)
    let maxIdx = 0;
    let maxVal = probabilities[0];
    for (let i = 1; i < probabilities.length; i++) {
      if (probabilities[i] > maxVal) {
        maxVal = probabilities[i];
        maxIdx = i;
      }
    }

    const label = LABELS_LIST[maxIdx];
    const confidence = maxVal;

    return {
      diseaseId: LABELS_MAP[label] || 'Saudável',
      confidence: parseFloat(confidence.toFixed(2)),
      inferenceTimeMs: Date.now() - startTime,
      modelUsed: 'tflite_custom_vision_mobile_v1.0',
    };
  } catch {
    console.error('[Inference] Real local TFLite inference execution failed.');
    throw new Error('Falha ao processar a imagem no modelo de IA local.');
  }
}
