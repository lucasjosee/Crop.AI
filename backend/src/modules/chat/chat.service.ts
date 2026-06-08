// backend/src/modules/chat/chat.service.ts
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { doencas, defensivos, doencaDefensivo } from '../../db/schema';
import { AGRONOMO_SYSTEM_PROMPT } from '../../config/llm';
import { createLLMProvider, LLMProvider, StreamCallbacks } from './providers/llm.provider';
import { ChatStreamInput } from './chat.schema';
import { AppError } from '../../shared/errors';

interface JwtUser {
  sub: string;
  role: string;
}

export class ChatService {
  private provider: LLMProvider;

  constructor(provider?: LLMProvider) {
    this.provider = provider ?? createLLMProvider();
  }

  async stream(
    input: ChatStreamInput,
    user: JwtUser,
    callbacks: StreamCallbacks
  ): Promise<void> {
    const contextBlock = await this.buildContextBlock(input.context);
    const systemPrompt = contextBlock
      ? `${AGRONOMO_SYSTEM_PROMPT}\n\n[Contexto do Diagnóstico]\n${contextBlock}`
      : AGRONOMO_SYSTEM_PROMPT;

    try {
      await this.provider.stream(systemPrompt, input.history, input.message, callbacks);
    } catch (err: any) {
      throw new AppError(502, 'LLM_UNAVAILABLE', `Serviço de IA indisponível: ${err.message}`);
    }
  }

  private async buildContextBlock(
    context: ChatStreamInput['context']
  ): Promise<string> {
    if (!context?.doenca_identificada) return '';

    const doenca = await db.query.doencas.findFirst({
      where: eq(doencas.nomeComum, context.doenca_identificada),
    });

    if (!doenca) return '';

    const defensivosData = await db
      .select({
        nomeComercial: defensivos.nomeComercial,
        ingredienteAtivo: defensivos.ingredienteAtivo,
        dosagemRecomendada: doencaDefensivo.dosagemRecomendada,
        carenciaDias: doencaDefensivo.carenciaDias,
      })
      .from(doencaDefensivo)
      .innerJoin(defensivos, eq(doencaDefensivo.idDefensivo, defensivos.id))
      .where(eq(doencaDefensivo.idDoenca, doenca.id));

    let block = `Cultura: ${context.cultura ?? 'Soja'}
Diagnóstico da Visão Computacional: ${doenca.nomeComum} (${doenca.nomeCientifico ?? 'N/A'})
Confiança: ${context.confianca_visao ? `${Math.round(context.confianca_visao * 100)}%` : 'N/A'}
Nível de Severidade: ${doenca.nivelSeveridade ?? 'N/A'}/5
Sintomas: ${doenca.sintomas ?? ''}`;

    if (defensivosData.length > 0) {
      block += '\n\nDefensivos indicados no catálogo:';
      for (const def of defensivosData) {
        block += `\n- ${def.nomeComercial} (${def.ingredienteAtivo}) — ${def.dosagemRecomendada} — Carência: ${def.carenciaDias} dias`;
      }
    }

    return block;
  }
}
