import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db';
import { usoLlm } from '../../db/schema';

export interface RegistroDeUso {
  userId: string;
  tipo: 'CHAT' | 'SEGUNDA_OPINIAO';
  provedor: string;
  modelo: string;
  tokensEntrada: number | null;
  tokensSaida: number | null;
  comImagem: boolean;
}

export interface UsoLlmRepository {
  /** Conversas do usuário nas últimas 24 horas (janela corrida). */
  contarChatsDasUltimas24h(userId: string): Promise<number>;
  registrar(registro: RegistroDeUso): Promise<void>;
}

export class DrizzleUsoLlmRepository implements UsoLlmRepository {
  async contarChatsDasUltimas24h(userId: string) {
    // O corte sai do relógio do banco, o mesmo que preenche created_at: a coluna
    // é timestamp sem fuso, e um corte vindo do Node divergiria se o fuso da
    // sessão do Postgres não fosse UTC.
    const [linha] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(usoLlm)
      .where(
        and(
          eq(usoLlm.userId, userId),
          eq(usoLlm.tipo, 'CHAT'),
          sql`${usoLlm.createdAt} > now() - interval '24 hours'`
        )
      );
    return linha?.total ?? 0;
  }

  async registrar(registro: RegistroDeUso) {
    await db.insert(usoLlm).values(registro);
  }
}

export const usoLlmRepository: UsoLlmRepository = new DrizzleUsoLlmRepository();
