import { GetObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../../config/env';
import { CROSS_VALIDATION_SYSTEM_PROMPT } from '../../config/llm';
import { s3Client } from '../../config/s3';
import type { LLMImageInput, LLMProvider } from '../chat/providers/llm.provider';
import { createLLMProvider } from '../chat/providers/llm.provider';
import { AppError, ConflictError, ValidationError } from '../../shared/errors';
import {
  llmCrossValidationSchema,
  type CrossValidationInput,
  type LlmCrossValidation,
} from './cross-validation.schema';
import {
  DrizzleCrossValidationRepository,
  type CatalogDisease,
  type CrossValidationRepository,
  type PersistedDiagnostic,
} from './cross-validation.repository';

export const CROSS_VALIDATION_TIMEOUT_MS = 15_000;

export interface DiagnosticImageLoader {
  load(s3Key: string): Promise<LLMImageInput>;
}

/**
 * Teto de 10MB, o mesmo que o app valida antes de enviar. O presigned PUT não
 * consegue impor `content-length-range` (é recurso da forma POST), então o
 * tamanho do objeto é controlado pelo cliente: sem este teto, bufferizar o
 * objeto inteiro e ainda gerar um base64 ~33% maior derruba o processo.
 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

class S3DiagnosticImageLoader implements DiagnosticImageLoader {
  async load(s3Key: string): Promise<LLMImageInput> {
    try {
      const response = await s3Client.send(
        new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: s3Key })
      );
      if (typeof response.ContentLength === 'number' && response.ContentLength > MAX_IMAGE_BYTES) {
        throw new AppError(
          413,
          'IMAGE_TOO_LARGE',
          'A imagem excede o limite de 10MB para a segunda opinião.'
        );
      }
      const body = response.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
      if (!body?.transformToByteArray) throw new Error('S3 retornou uma imagem sem conteúdo.');
      const bytes = await body.transformToByteArray();
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        throw new AppError(
          413,
          'IMAGE_TOO_LARGE',
          'A imagem excede o limite de 10MB para a segunda opinião.'
        );
      }
      const mimeType = response.ContentType === 'image/png' ? 'image/png' : 'image/jpeg';
      return { dataBase64: Buffer.from(bytes).toString('base64'), mimeType };
    } catch (error: any) {
      if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) {
        throw new AppError(404, 'IMAGE_NOT_FOUND', 'A imagem informada não foi encontrada.');
      }
      if (error instanceof AppError) throw error;
      throw new AppError(502, 'IMAGE_UNAVAILABLE', 'Não foi possível carregar a imagem para análise.');
    }
  }
}

/**
 * A varredura primeiro-`{` / último-`}` quebrava sempre que o modelo escrevia
 * qualquer coisa com chave depois do JSON — o que é rotineiro no Claude, que só
 * é instruído em prosa a responder JSON, enquanto o Gemini força
 * `responseMimeType: application/json`. Um veredito válido virava 502 e a
 * inferência paga era descartada.
 */
function extractJson(text: string): unknown {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Segue para as estratégias de extração.
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // Segue para a varredura balanceada.
    }
  }

  // Varredura contando chaves e ignorando o que está dentro de string, para
  // fechar no objeto correto em vez de no último `}` do texto inteiro.
  const start = trimmed.indexOf('{');
  if (start < 0) throw new Error('Resposta do provedor não contém JSON.');

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      return JSON.parse(trimmed.slice(start, i + 1));
    }
  }

  throw new Error('Resposta do provedor não contém um JSON completo.');
}

function toResponse(record: PersistedDiagnostic, llmDiseaseName: string | null = null) {
  const resultStatus = record.crossValidationStatus as 'CONFIRMED' | 'ENRICHED' | 'DIVERGENT';
  return {
    status: 'success' as const,
    cross_validation: {
      result_status: resultStatus,
      llm_agrees_with_cv: resultStatus !== 'DIVERGENT',
      llm_doenca_id: record.llmDoencaId,
      llm_doenca_nome: llmDiseaseName,
      llm_observacoes: record.llmObservacoes ?? '',
      llm_confianca: record.llmConfianca ?? 0,
    },
  };
}

export class CrossValidationService {
  constructor(
    private readonly provider: LLMProvider = createLLMProvider(),
    private readonly repository: CrossValidationRepository = new DrizzleCrossValidationRepository(),
    private readonly imageLoader: DiagnosticImageLoader = new S3DiagnosticImageLoader(),
    private readonly timeoutMs = CROSS_VALIDATION_TIMEOUT_MS
  ) {}

  async crossValidate(userId: string, input: CrossValidationInput) {
    const expectedPrefix = `diagnosticos/${userId}/`;
    if (!input.image_s3_key.startsWith(expectedPrefix)) {
      throw new ValidationError('A imagem não pertence ao usuário autenticado.');
    }

    const cvDisease = await this.repository.findDisease(input.cv_result.doenca_id);
    if (!cvDisease) throw new ValidationError('O doenca_id do resultado visual não existe no catálogo.');

    let diagnostic = await this.repository.findDiagnostic(userId, input.diagnostic_local_id);
    if (diagnostic && diagnostic.imageS3Key !== input.image_s3_key) {
      throw new ConflictError('O diagnóstico já está associado a outra imagem.');
    }
    if (
      diagnostic &&
      ['CONFIRMED', 'ENRICHED', 'DIVERGENT'].includes(diagnostic.crossValidationStatus)
    ) {
      const llmDisease = diagnostic.llmDoencaId
        ? await this.repository.findDisease(diagnostic.llmDoencaId)
        : undefined;
      // O nome persistido preserva o que o LLM afirmou mesmo quando a doença
      // não está no catálogo — sem isso a repetição devolvia null onde a
      // primeira chamada devolvera a string do modelo, escondendo a divergência.
      return toResponse(diagnostic, llmDisease?.nome ?? diagnostic.llmDoencaNome ?? null);
    }
    diagnostic ??= await this.repository.createPending(userId, input);

    const [image, catalog] = await Promise.all([
      this.imageLoader.load(input.image_s3_key),
      this.repository.listActiveDiseases(),
    ]);

    const prompt = this.buildPrompt(input, cvDisease, catalog);
    let rawResponse: string;
    try {
      rawResponse = await this.withTimeout(
        this.provider.analyzeImage(CROSS_VALIDATION_SYSTEM_PROMPT, prompt, image)
      );
    } catch (error: any) {
      // Sem sair de PENDING, o cliente offline-first re-tenta indefinidamente e
      // cada ciclo custa um GetObject no S3 mais uma inferência de visão paga.
      // SKIPPED é o mesmo estado que o app já usa quando a segunda opinião
      // falha, e mantém o diagnóstico local válido.
      await this.repository.markSkipped(diagnostic.id);
      if (error?.message === 'LLM_TIMEOUT') {
        throw new AppError(504, 'LLM_TIMEOUT', 'A segunda opinião excedeu o limite de 15 segundos.');
      }
      if (error instanceof AppError) throw error;
      throw new AppError(502, 'LLM_UNAVAILABLE', 'O serviço de segunda opinião está indisponível.');
    }

    let result: LlmCrossValidation;
    try {
      result = llmCrossValidationSchema.parse(extractJson(rawResponse));
    } catch {
      await this.repository.markSkipped(diagnostic.id);
      throw new AppError(502, 'LLM_UNAVAILABLE', 'O provedor retornou uma resposta inválida.');
    }

    const catalogDisease =
      result.result_status === 'DIVERGENT'
        ? catalog.find((disease) => disease.id === result.llm_doenca_id) ??
          catalog.find(
            (disease) =>
              disease.nome.toLocaleLowerCase('pt-BR') ===
              result.llm_doenca_nome?.toLocaleLowerCase('pt-BR')
          )
        : undefined;
    const normalized = {
      ...result,
      llm_doenca_id: catalogDisease?.id ?? null,
      llm_doenca_nome: catalogDisease?.nome ?? result.llm_doenca_nome,
    };
    await this.repository.saveResult(diagnostic.id, normalized);

    return {
      status: 'success' as const,
      cross_validation: {
        result_status: normalized.result_status,
        llm_agrees_with_cv: normalized.result_status !== 'DIVERGENT',
        llm_doenca_id: normalized.llm_doenca_id,
        llm_doenca_nome:
          normalized.result_status === 'DIVERGENT' ? normalized.llm_doenca_nome ?? null : null,
        llm_observacoes: normalized.llm_observacoes,
        llm_confianca: normalized.llm_confianca,
      },
    };
  }

  private buildPrompt(
    input: CrossValidationInput,
    cvDisease: CatalogDisease,
    catalog: CatalogDisease[]
  ) {
    return `Analise a imagem da folha de soja e compare com a âncora do modelo local.

Âncora CV:
- doença: ${cvDisease.nome}
- doença_id: ${cvDisease.id}
- confiança: ${input.cv_result.confianca}
- modelo: ${input.cv_result.modelo_usado}

Catálogo permitido:
${catalog.map((disease) => `- ${disease.id}: ${disease.nome}`).join('\n')}

Retorne somente JSON com: result_status (CONFIRMED, ENRICHED ou DIVERGENT), llm_doenca_id (somente ID do catálogo ou null), llm_doenca_nome (ou null), llm_observacoes e llm_confianca (0 a 1).
Use CONFIRMED quando concordar sem informação adicional relevante; ENRICHED quando concordar e houver observações visuais extras; DIVERGENT quando sugerir outra doença. Nunca esconda divergência.`;
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error('LLM_TIMEOUT')), this.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export const crossValidationService = new CrossValidationService();
