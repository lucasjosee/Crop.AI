import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { app } from '../../app';
import { db } from '../../db';
import { usuarios, refreshTokens } from '../../db/schema';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://minio.local/presigned-put-url?X-Amz-Signature=abc'),
}));

describe('UploadService (unit)', () => {
  it('gera s3_key no formato diagnosticos/{userId}/{uuid}.jpg e expiry 600s', async () => {
    const { uploadService } = await import('./upload.service');
    const res = await uploadService.createUploadUrl('user-123', 'image/jpeg');
    expect(res.upload_url).toContain('presigned-put-url');
    expect(res.s3_key).toMatch(/^diagnosticos\/user-123\/[0-9a-f-]{36}\.jpg$/);
    expect(res.expires_in).toBe(600);
  });

  it('usa extensão .png para image/png', async () => {
    const { uploadService } = await import('./upload.service');
    const res = await uploadService.createUploadUrl('user-123', 'image/png');
    expect(res.s3_key).toMatch(/\.png$/);
  });
});

describe('POST /api/v1/upload/url (integration)', () => {
  let accessToken: string;

  beforeAll(async () => {
    await app.ready();
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { nome: 'Upload Tester', email: 'upload@test.com', password: 'senha123!' },
    });
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'upload@test.com', password: 'senha123!' },
    });
    accessToken = JSON.parse(loginRes.body).access_token;
  });

  afterAll(async () => {
    await db.delete(refreshTokens);
    await db.delete(usuarios);
    await app.close();
  });

  it('retorna 401 sem token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/upload/url',
      payload: { filename: 'foto.jpg', content_type: 'image/jpeg' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('retorna 400 para content_type não suportado', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/upload/url',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { filename: 'doc.pdf', content_type: 'application/pdf' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('retorna upload_url, s3_key e expires_in (T5.1 unit-level)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/upload/url',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { filename: 'diagnostico_2026-06-10.jpg', content_type: 'image/jpeg' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.upload_url).toBeTruthy();
    expect(body.s3_key).toMatch(/^diagnosticos\//);
    expect(body.expires_in).toBe(600);
  });
});
