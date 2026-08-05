import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('../db/sqlite', () => ({ dbDriver: { execute: mocks.execute } }));
vi.mock('./api', () => ({ api: { post: vi.fn() } }));

import { api } from './api';
import { ensureDiagnosticImageUploaded } from './diagnosticImageUploadService';

describe('ensureDiagnosticImageUploaded', () => {
  beforeEach(() => vi.clearAllMocks());

  it('não solicita nova URL quando o diagnóstico já tem image_s3_key', async () => {
    const key = await ensureDiagnosticImageUploaded({
      localId: 'local-1',
      imageUri: 'file:///leaf.jpg',
      imageS3Key: 'diagnosticos/user/existing.jpg',
    });

    expect(key).toBe('diagnosticos/user/existing.jpg');
    expect(api.post).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
