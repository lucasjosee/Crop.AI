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

    // Tudo numa transação, com a linha do token apresentado travada: duas
    // re-tentativas simultâneas não geram dois sucessores vivos (ADR 0006).
    // A revogação geral precisa persistir mesmo quando a rota devolve 403, e
    // um throw dentro da transação a desfaria; por isso a transação devolve o
    // veredito e o erro é lançado depois do commit.
    type Veredito =
      | { negado: string; user?: undefined; newRawRefreshToken?: undefined }
      | { negado?: undefined; user: typeof usuarios.$inferSelect; newRawRefreshToken: string };

    const resultado = await db.transaction(async (tx): Promise<Veredito> => {
      const [tokenRecord] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .limit(1)
        .for('update');

      if (!tokenRecord) {
        return { negado: 'Refresh token inválido ou não encontrado.' } as const;
      }

      const agora = new Date();
      const expirado = agora > tokenRecord.expiresAt;
      let respostaPerdida = false;

      if (tokenRecord.revokedAt) {
        if (tokenRecord.replacedById && !expirado) {
          const [sucessor] = await tx
            .select()
            .from(refreshTokens)
            .where(eq(refreshTokens.id, tokenRecord.replacedById))
            .limit(1)
            .for('update');
          respostaPerdida = !!sucessor && !sucessor.revokedAt && agora <= sucessor.expiresAt;
          if (respostaPerdida) {
            // O sucessor nunca chegou ao aparelho: foi suplantado, não rotacionado.
            await tx
              .update(refreshTokens)
              .set({ revokedAt: agora })
              .where(eq(refreshTokens.id, sucessor.id));
          }
        }

        if (!respostaPerdida) {
          // Reuso detectado: revoga todas as sessões do usuário.
          await tx
            .update(refreshTokens)
            .set({ revokedAt: agora })
            .where(eq(refreshTokens.userId, tokenRecord.userId));
          return {
            negado:
              'Refresh token já utilizado. Todas as sessões ativas do usuário foram revogadas por segurança.',
          } as const;
        }
      } else if (expirado) {
        return { negado: 'Refresh token expirado. Faça login novamente.' } as const;
      }

      const user = await tx.query.usuarios.findFirst({
        where: eq(usuarios.id, tokenRecord.userId),
      });

      if (!user || user.deletedAt) {
        return { negado: 'Usuário associado não encontrado ou inativo.' } as const;
      }

      const newRawRefreshToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

      const [novo] = await tx
        .insert(refreshTokens)
        .values({
          userId: user.id,
          tokenHash: hashToken(newRawRefreshToken),
          deviceInfo: tokenRecord.deviceInfo,
          expiresAt,
        })
        .returning({ id: refreshTokens.id });

      // Rotação (ou resposta perdida): o apresentado aponta para o novo sucessor.
      await tx
        .update(refreshTokens)
        .set({ revokedAt: tokenRecord.revokedAt ?? agora, replacedById: novo.id })
        .where(eq(refreshTokens.id, tokenRecord.id));

      return { user, newRawRefreshToken } as const;
    });

    if (resultado.negado !== undefined) {
      throw new ForbiddenError(resultado.negado, 'REFRESH_DENIED');
    }

    const newAccessToken = jwtSign({
      sub: resultado.user.id,
      role: resultado.user.role,
    });

    return {
      access_token: newAccessToken,
      refresh_token: resultado.newRawRefreshToken,
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
