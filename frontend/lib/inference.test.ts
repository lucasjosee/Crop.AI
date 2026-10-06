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

/**
 * Saída do modelo como a biblioteca real a devolve: um ArrayBuffer cru
 * (TfliteModel.run: Promise<ArrayBuffer[]>), nunca um Float32Array.
 */
function bufferDeProbabilidades(total: number, pico: number): ArrayBuffer {
  const probs = new Float32Array(total).fill(0.01);
  probs[pico] = 0.9;
  return probs.buffer;
}

/** Saída com 17 posições (uma por classe) e o máximo no índice pedido. */
function probabilitiesWithPeakAt(index: number): ArrayBuffer {
  return bufferDeProbabilidades(LABELS_LIST.length, index);
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

  it('entrega ao modelo um ArrayBuffer, não um Float32Array', async () => {
    mocks.run.mockResolvedValue([probabilitiesWithPeakAt(0)]);

    await runImageInference('file:///folha.jpg');

    const entrada = mocks.run.mock.calls[0][0][0];
    expect(entrada).toBeInstanceOf(ArrayBuffer);
    expect(entrada.byteLength).toBe(300 * 300 * 3 * 4);
  });

  it('interpreta a saída ArrayBuffer como Float32Array e resolve a classe do pico', async () => {
    const mancha = LABELS_LIST.indexOf('Mancha Alvo');
    mocks.run.mockResolvedValue([bufferDeProbabilidades(17, mancha)]);

    const result = await runImageInference('file:///folha.jpg');

    expect(result.diseaseId).toBe(LABELS_MAP['Mancha Alvo']);
    expect(result.confidence).toBe(0.9);
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

  it('rejeita e nunca resolve com Saudável quando o modelo devolve mais classes que LABELS_LIST', async () => {
    // índice 17 fora de LABELS_LIST (17 classes, índices 0-16)
    const saida = bufferDeProbabilidades(18, 17);
    mocks.run.mockResolvedValue([saida]);

    let resultado: Awaited<ReturnType<typeof runImageInference>> | undefined;
    let erroCapturado: unknown;
    try {
      resultado = await runImageInference('file:///folha.jpg');
    } catch (erro) {
      erroCapturado = erro;
    }

    expect(erroCapturado).toBeInstanceOf(Error);
    expect(resultado).toBeUndefined();
    expect(resultado?.diseaseId).not.toBe('Saudável');
  });

  it('rejeita quando o modelo devolve menos classes que LABELS_LIST', async () => {
    const saida = bufferDeProbabilidades(16, 15);
    mocks.run.mockResolvedValue([saida]);

    await expect(runImageInference('file:///folha.jpg')).rejects.toThrow();
  });

  it('devolve Saudável de verdade quando o argmax cai no índice correto de Saudável', async () => {
    const saudavel = LABELS_LIST.indexOf('Saudável');
    mocks.run.mockResolvedValue([probabilitiesWithPeakAt(saudavel)]);

    const result = await runImageInference('file:///folha.jpg');

    expect(result.diseaseId).toBe('Saudável');
  });

  it('traduz Fitotoxicidade de Cobre para a chave especial Fitotoxicidade', async () => {
    const fito = LABELS_LIST.indexOf('Fitotoxicidade de Cobre');
    mocks.run.mockResolvedValue([probabilitiesWithPeakAt(fito)]);

    const result = await runImageInference('file:///folha.jpg');

    expect(result.diseaseId).toBe('Fitotoxicidade');
  });

  it('mapeia Ferrugem para o UUID do catálogo', async () => {
    const ferrugem = LABELS_LIST.indexOf('Ferrugem');
    mocks.run.mockResolvedValue([probabilitiesWithPeakAt(ferrugem)]);

    const result = await runImageInference('file:///folha.jpg');

    expect(result.diseaseId).toBe('3f34559c-6a12-4eb2-a42e-cf629ec2e9e6');
  });

  it('LABELS_LIST e as chaves de LABELS_MAP têm o mesmo conteúdo (guarda contra deriva)', () => {
    const chavesDoMapa = Object.keys(LABELS_MAP);

    expect(chavesDoMapa.sort()).toEqual([...LABELS_LIST].sort());
  });
});
