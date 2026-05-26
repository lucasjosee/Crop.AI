import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { app } from '../../app';
import { db } from '../../db';
import { usuarios, refreshTokens } from '../../db/schema';

async function cleanupDb() {
  await db.delete(refreshTokens);
  await db.delete(usuarios);
}

describe('Auth Module Integration Tests', () => {
  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(async () => {
    await cleanupDb();
  });

  afterAll(async () => {
    await cleanupDb();
    await app.close();
  });

  const testUser = {
    nome: 'Test User',
    email: 'test@example.com',
    password: 'password123!',
  };

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: testUser,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('user');
      expect(body.user.nome).toBe(testUser.nome);
      expect(body.user.email).toBe(testUser.email);
      expect(body.user.role).toBe('PRODUTOR');
      expect(body.user).not.toHaveProperty('passwordHash');
      expect(body.user).not.toHaveProperty('password');
    });

    it('should fail registration with duplicate email', async () => {
      // First registration
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: testUser,
      });

      // Second registration with same email
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          nome: 'Another User',
          email: testUser.email,
          password: 'anotherPassword123!',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('já cadastrado');
    });

    it('should fail registration with invalid input', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          nome: 'T', // less than 2 chars
          email: 'invalid-email',
          password: '123', // less than 8 chars
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.length).toBe(3);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      // Register test user before each login test
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: testUser,
      });
    });

    it('should log in successfully with valid credentials', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: testUser.email,
          password: testUser.password,
          device_info: 'Vitest Runner',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('access_token');
      expect(body).toHaveProperty('refresh_token');
      expect(body.expires_in).toBe(900);
      expect(body.token_type).toBe('Bearer');
    });

    it('should fail login with invalid password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: testUser.email,
          password: 'wrongpassword',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should fail login with non-existent email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'nonexistent@example.com',
          password: testUser.password,
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('Token Rotation & Session Revocation', () => {
    let tokens: { access_token: string; refresh_token: string };

    beforeEach(async () => {
      // Register
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: testUser,
      });

      // Login
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: testUser.email,
          password: testUser.password,
        },
      });
      tokens = JSON.parse(loginRes.body);
    });

    it('should access protected route with valid access token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/protected',
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('accessed successfully');
    });

    it('should block access to protected route with invalid/expired access token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/protected',
        headers: {
          Authorization: 'Bearer invalid_token',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should rotate tokens successfully using refresh token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: {
          refresh_token: tokens.refresh_token,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('access_token');
      expect(body).toHaveProperty('refresh_token');
      expect(body.refresh_token).not.toBe(tokens.refresh_token);

      // Verify the new access token works
      const protectedRes = await app.inject({
        method: 'GET',
        url: '/api/v1/protected',
        headers: {
          Authorization: `Bearer ${body.access_token}`,
        },
      });
      expect(protectedRes.statusCode).toBe(200);
    });

    it('should block and invalidate all sessions if a refresh token is reused', async () => {
      // 1. First refresh (should succeed and revoke the original token)
      const firstRefresh = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: {
          refresh_token: tokens.refresh_token,
        },
      });
      expect(firstRefresh.statusCode).toBe(200);
      const firstRefreshTokens = JSON.parse(firstRefresh.body);

      // 2. Second refresh attempting to use the SAME old token (reused)
      const secondRefresh = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: {
          refresh_token: tokens.refresh_token,
        },
      });

      expect(secondRefresh.statusCode).toBe(403);
      const secondRefreshBody = JSON.parse(secondRefresh.body);
      expect(secondRefreshBody.error.code).toBe('REFRESH_DENIED');
      expect(secondRefreshBody.error.message).toContain('já utilizado');

      // 3. Verify that the NEW refresh token got invalidated as well
      const thirdRefresh = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: {
          refresh_token: firstRefreshTokens.refresh_token,
        },
      });
      expect(thirdRefresh.statusCode).toBe(403);
    });

    it('should logout and invalidate the refresh token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
        payload: {
          refresh_token: tokens.refresh_token,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).status).toBe('success');

      // Try to refresh (should fail as it was revoked during logout)
      const refreshRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: {
          refresh_token: tokens.refresh_token,
        },
      });
      expect(refreshRes.statusCode).toBe(403);
    });
  });
});
