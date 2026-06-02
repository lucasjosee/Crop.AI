import { vi, describe, it, expect } from 'vitest';

// Mock react-native before any imports that use it
vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

import { runImageInference, LABELS_MAP } from './inference';

describe('Local AI Inference Helper', () => {
  it('should return a structured result with inference metrics', async () => {
    const res = await runImageInference('file:///path/leaf.jpg');
    
    expect(res).toBeDefined();
    expect(res.confidence).toBeGreaterThanOrEqual(0);
    expect(res.confidence).toBeLessThanOrEqual(1);
    expect(res.inferenceTimeMs).toBeGreaterThanOrEqual(0);
    expect(res.modelUsed).toBeDefined();
    expect(Object.values(LABELS_MAP)).toContain(res.diseaseId);
  });

  it('should match keywords from image path to determine diagnosis', async () => {
    const resFerrugem = await runImageInference('file:///cache/folha_com_ferrugem_asiatica.jpg');
    expect(resFerrugem.diseaseId).toBe('3f34559c-6a12-4eb2-a42e-cf629ec2e9e6'); // Ferrugem UUID

    const resMancha = await runImageInference('file:///cache/mancha_alvo_teste.jpg');
    expect(resMancha.diseaseId).toBe('5be520ca-a6fc-46cd-ae38-fc62157a44f1'); // Mancha Alvo UUID

    const resFito = await runImageInference('file:///cache/dano_fito_folha.jpg');
    expect(resFito.diseaseId).toBe('Fitotoxicidade');

    const resSaudavel = await runImageInference('file:///cache/soja_saudavel.jpg');
    expect(resSaudavel.diseaseId).toBe('Saudável');
  });

  it('should respect forcedMode override parameter when supplied', async () => {
    const forcedType = '5be520ca-a6fc-46cd-ae38-fc62157a44f1'; // Mancha Alvo UUID
    const res = await runImageInference('file:///cache/any.jpg', forcedType);
    
    expect(res.diseaseId).toBe(forcedType);
  });
});
