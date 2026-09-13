import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  loadTensorflowModel: vi.fn(),
  manipulateAsync: vi.fn(),
  decode: vi.fn(),
}));

vi.mock('react-native-fast-tflite', () => ({ loadTensorflowModel: mocks.loadTensorflowModel }));
vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: mocks.manipulateAsync,
  SaveFormat: { JPEG: 'jpeg' },
}));
vi.mock('jpeg-js', () => ({ decode: mocks.decode }));
vi.mock('../assets/models/model.tflite', () => ({ default: 1 }));

type InferenceModule = typeof import('./inference');
let runImageInference: InferenceModule['runImageInference'];
let LABELS_LIST: InferenceModule['LABELS_LIST'];
let LABELS_MAP: InferenceModule['LABELS_MAP'];

/** Vetor de probabilidades com 17 posições e o máximo no índice pedido. */
function probabilitiesWithPeakAt(index: number): Float32Array {
  const probs = new Float32Array(LABELS_LIST.length).fill(0.01);
  probs[index] = 0.9;
  return probs;
}

describe('runImageInference (caminho nativo)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    ({ runImageInference, LABELS_LIST, LABELS_MAP } = await import('./inference'));
    mocks.loadTensorflowModel.mockResolvedValue({ run: mocks.run });
    mocks.manipulateAsync.mockResolvedValue({ base64: 'AAAA' });
    mocks.decode.mockReturnValue({ data: new Uint8Array(300 * 300 * 4) });
  });

  it('mapeia o argmax da saída do modelo para o id de doença do catálogo', async () => {
    const ferrugem = LABELS_LIST.indexOf('Ferrugem');
    mocks.run.mockResolvedValue([probabilitiesWithPeakAt(ferrugem)]);

    const result = await runImageInference('file:///folha.jpg');

    expect(result.diseaseId).toBe(LABELS_MAP['Ferrugem']);
    expect(result.confidence).toBe(0.9);
    expect(result.modelUsed).toBe('tflite_custom_vision_mobile_v1.0');
    expect(result.inferenceTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('redimensiona para 300x300 antes de inferir', async () => {
    mocks.run.mockResolvedValue([probabilitiesWithPeakAt(0)]);

    await runImageInference('file:///folha.jpg');

    expect(mocks.manipulateAsync).toHaveBeenCalledWith(
      'file:///folha.jpg',
      [{ resize: { width: 300, height: 300 } }],
      expect.objectContaining({ base64: true })
    );
  });

  it('carrega o modelo uma única vez por sessão', async () => {
    mocks.run.mockResolvedValue([probabilitiesWithPeakAt(0)]);

    await runImageInference('file:///a.jpg');
    await runImageInference('file:///b.jpg');

    expect(mocks.loadTensorflowModel).toHaveBeenCalledTimes(1);
  });

  it('respeita forcedMode sem tocar no modelo', async () => {
    const result = await runImageInference('file:///x.jpg', 'Saudável');

    expect(result.diseaseId).toBe('Saudável');
    expect(result.modelUsed).toBe('tflite_mock_mobile_forced_v1.0');
    expect(mocks.loadTensorflowModel).not.toHaveBeenCalled();
  });
});
