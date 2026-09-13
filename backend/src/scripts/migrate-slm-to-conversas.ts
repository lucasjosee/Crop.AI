/**
 * Move a telemetria de `sessoes_slm`/`interacoes_slm` para `conversas`/`mensagens`,
 * one-shot, antes de as duas tabelas antigas saírem do schema.
 *
 * Os ids derivados precisam casar com os que a migração v7 do aparelho gerou
 * (`<mobile_session_id>-u<i>` / `-a<i>`): é isso que faz a conversa que já
 * subiu como telemetria reencontrar a própria linha quando o aparelho a
 * empurrar de novo, em vez de virar uma segunda cópia.
 *
 * Uso:
 *   npx tsx src/scripts/migrate-slm-to-conversas.ts --dry-run
 *   npx tsx src/scripts/migrate-slm-to-conversas.ts
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, pool } from '../db';
import { conversas, mensagens } from '../db/schema';

// `db.execute<T>` exige T compatível com `Record<string, unknown>`; `interface`
// não satisfaz essa restrição estrutural sem index signature explícita, então
// as linhas cruas usam `type` em vez de `interface`.
type LinhaSessao = {
  id: string;
  user_id: string;
  mobile_session_id: string;
  // O driver node-postgres do Drizzle desliga o parser automático de data
  // (ver node-postgres/session.js) e devolve timestamp cru como texto sem
  // timezone, ex. "2026-09-13 18:30:29.097812" — nunca um objeto Date.
  started_at: string;
};

type LinhaInteracao = {
  prompt: string | null;
  response: string | null;
  latency_ms: number | null;
};

const dryRun = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  // ORDER BY created_at, ctid: `interacoes_slm` foi gravada com um INSERT de
  // várias linhas e `created_at` tem default now(), que é o tempo do comando —
  // todas as interações de uma sessão carregam o mesmo instante. `ctid` é a
  // posição física e, em linhas nunca atualizadas, devolve a ordem de inserção.
  const sessoes = await db.execute<LinhaSessao>(sql`
    SELECT id, user_id, mobile_session_id, started_at
      FROM sessoes_slm
     ORDER BY started_at, ctid
  `);

  let conversasCriadas = 0;
  let mensagensCriadas = 0;
  let sessoesVazias = 0;

  for (const sessao of sessoes.rows) {
    const interacoes = await db.execute<LinhaInteracao>(sql`
      SELECT prompt, response, latency_ms
        FROM interacoes_slm
       WHERE sessao_id = ${sessao.id}
       ORDER BY created_at, ctid
    `);

    if (interacoes.rows.length === 0) {
      sessoesVazias += 1;
      continue;
    }

    const titulo = String(interacoes.rows[0].prompt ?? '').slice(0, 60) || 'Conversa';
    // O texto sem timezone é sempre um instante UTC (é como o Postgres desta
    // aplicação guarda timestamp): sem ancorar com "Z", o `Date` do Node lê o
    // espaço em vez do "T" como hora local da máquina que roda o script, e o
    // timestamp migrado sai deslocado pelo fuso de quem executou.
    const criadaEm = new Date(`${sessao.started_at.replace(' ', 'T')}Z`);

    if (dryRun) {
      conversasCriadas += 1;
      mensagensCriadas += interacoes.rows.length * 2;
      continue;
    }

    const inseridas = await db
      .insert(conversas)
      .values({
        userId: sessao.user_id,
        mobileSessionId: sessao.mobile_session_id,
        titulo,
        criadaEm,
        atualizadaEm: criadaEm,
      })
      .onConflictDoNothing({ target: [conversas.userId, conversas.mobileSessionId] })
      .returning({ id: conversas.id });

    // returning vazio significa que a conversa já existia — o aparelho a
    // empurrou antes de este script rodar. Reaproveitar a linha dela é o que
    // torna o script idempotente.
    let conversaId = inseridas[0]?.id;
    if (!conversaId) {
      const existente = await db.query.conversas.findFirst({
        where: and(
          eq(conversas.userId, sessao.user_id),
          eq(conversas.mobileSessionId, sessao.mobile_session_id)
        ),
      });
      if (!existente) continue;
      conversaId = existente.id;
    } else {
      conversasCriadas += 1;
    }

    // Mesma aritmética de timestamp da migração v7 do aparelho: base + 2i para
    // a pergunta, +1 para a resposta.
    const base = criadaEm.getTime();
    const linhas = interacoes.rows.flatMap((interacao, i) => [
      {
        conversaId,
        mobileMessageId: `${sessao.mobile_session_id}-u${i}`,
        papel: 'user' as const,
        conteudo: String(interacao.prompt ?? ''),
        origem: null,
        criadaEm: new Date(base + i * 2),
      },
      {
        conversaId,
        mobileMessageId: `${sessao.mobile_session_id}-a${i}`,
        papel: 'assistant' as const,
        conteudo: String(interacao.response ?? ''),
        origem: 'LOCAL_SLM' as const,
        latencyMs: interacao.latency_ms ?? null,
        criadaEm: new Date(base + i * 2 + 1),
      },
    ]);

    const gravadas = await db
      .insert(mensagens)
      .values(linhas)
      .onConflictDoNothing({ target: [mensagens.conversaId, mensagens.mobileMessageId] })
      .returning({ id: mensagens.id });

    mensagensCriadas += gravadas.length;
  }

  console.log(dryRun ? '[dry-run] Nada foi escrito.' : '[migração] Concluída.');
  console.log(`  sessões lidas:      ${sessoes.rows.length}`);
  console.log(`  sessões sem interação (puladas): ${sessoesVazias}`);
  console.log(`  conversas criadas:  ${conversasCriadas}`);
  console.log(`  mensagens criadas:  ${mensagensCriadas}`);
}

main()
  .catch((erro) => {
    console.error('[migração] Falhou:', erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
