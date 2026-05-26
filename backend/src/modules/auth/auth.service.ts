import crypto from 'crypto';
import argon2 from 'argon2';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../../db';
import { usuarios, refreshTokens } from '../../db/schema';
import { ConflictError, UnauthorizedError, ForbiddenError } from '../../shared/errors';
import { RegisterInput, LoginInput } from './auth.schema';

// Helper to hash opaque refresh token (SHA256)
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class AuthService {
  async register(input: RegisterInput) {
    const { nome, email, password } = input;

    // Check if email already exists
    const existingUser = await db.query.usuarios.findFirst({
      where: eq(usuarios.email, email),
    });

    if (existingUser) {
      throw new ConflictError('E-mail já cadastrado no sistema.');
    }

    // Hash password with Argon2id
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
    });

    // Create user
    const [newUser] = await db
      .insert(usuarios)
      .values({
        nome,
        email,
        passwordHash,
        role: 'PRODUTOR',
      })
      .returning();

    return {
      id: newUser.id,
      nome: newUser.nome,
      email: newUser.email,
      role: newUser.role,
      created_at: newUser.createdAt.toISOString(),
    };
  }

  async login(input: LoginInput, jwtSign: (payload: any) => string) {
    const { email, password, device_info } = input;

    // Find active user
    const user = await db.query.usuarios.findFirst({
      where: and(
        eq(usuarios.email, email),
        isNull(usuarios.deletedAt)
      ),
    });

    if (!user) {
      throw new UnauthorizedError('Credenciais inválidas (e-mail ou senha incorretos).');
    }

    // Compare password
    const isPasswordValid = await argon2.verify(user.passwordHash, password);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Credenciais inválidas (e-mail ou senha incorretos).');
    }

    // Generate Access Token (JWT) - 15 minutes
    const accessToken = jwtSign({
      sub: user.id,
      role: user.role,
    });

    // Generate Refresh Token (Opaque 32-byte hex)
    const rawRefreshToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawRefreshToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days expiration

    // Insert refresh token
    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash,
      deviceInfo: device_info || null,
      expiresAt,
    });

    return {
      access_token: accessToken,
      refresh_token: rawRefreshToken,
      expires_in: 900, // 15 mins in seconds
      token_type: 'Bearer',
    };
  }

  async refresh(refreshToken: string, jwtSign: (payload: any) => string) {
    const tokenHash = hashToken(refreshToken);

    // Find the token
    const tokenRecord = await db.query.refreshTokens.findFirst({
      where: eq(refreshTokens.tokenHash, tokenHash),
    });

    if (!tokenRecord) {
      throw new ForbiddenError('Refresh token inválido ou não encontrado.', 'REFRESH_DENIED');
    }

    // 1. REUSE DETECTION: If token is already revoked, it's a security breach
    if (tokenRecord.revokedAt) {
      // Invalidate ALL sessions for this user
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.userId, tokenRecord.userId));

      throw new ForbiddenError(
        'Refresh token já utilizado. Todas as sessões ativas do usuário foram revogadas por segurança.',
        'REFRESH_DENIED'
      );
    }

    // 2. EXPIRATION CHECK
    if (new Date() > tokenRecord.expiresAt) {
      throw new ForbiddenError('Refresh token expirado. Faça login novamente.', 'REFRESH_DENIED');
    }

    // Get the user
    const user = await db.query.usuarios.findFirst({
      where: eq(usuarios.id, tokenRecord.userId),
    });

    if (!user || user.deletedAt) {
      throw new ForbiddenError('Usuário associado não encontrado ou inativo.', 'REFRESH_DENIED');
    }

    // 3. ROTATION: Revoke the old token
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, tokenRecord.id));

    // Generate new pair
    const newAccessToken = jwtSign({
      sub: user.id,
      role: user.role,
    });

    const newRawRefreshToken = crypto.randomBytes(32).toString('hex');
    const newHash = hashToken(newRawRefreshToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

    // Insert new refresh token
    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: newHash,
      deviceInfo: tokenRecord.deviceInfo,
      expiresAt,
    });

    return {
      access_token: newAccessToken,
      refresh_token: newRawRefreshToken,
      expires_in: 900,
      token_type: 'Bearer',
    };
  }

  async logout(refreshToken: string) {
    const tokenHash = hashToken(refreshToken);

    // Revoke the token
    const [updated] = await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .returning();

    if (!updated) {
      throw new ForbiddenError('Refresh token inválido ou não encontrado.', 'REFRESH_DENIED');
    }

    return { status: 'success' };
  }
}
