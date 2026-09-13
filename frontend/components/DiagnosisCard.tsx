import React from 'react';
import { View, Text, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { theme } from '../config/theme';
import { Badge } from './Badge';
import { DefensivoItem } from './DefensivoItem';
import { getCrossValidationPriority } from '../lib/crossValidationService';
import type { DiagnosisDetails } from '../lib/diagnosisDetails';
import type { ChatAttachment } from '../lib/chatRepository';

interface DiagnosisCardProps {
  attachment: ChatAttachment;
  details: DiagnosisDetails;
  /**
   * Único dado que não vem do banco. O status é PENDING tanto enquanto a
   * chamada está em voo quanto quando ela nunca foi tentada; só a tela sabe
   * distinguir, porque é ela que disparou.
   */
  isValidating: boolean;
}

const AVISO_LEGAL =
  'ATENÇÃO: produto de uso agrícola, venda sob receituário agronômico. ' +
  'Consulte sempre um engenheiro agrônomo antes de aplicar (Lei 7.802/1989).';

function severidade(
  details: DiagnosisDetails,
  isHealthy: boolean,
  isPhyto: boolean
): { label: string; type: 'success' | 'warning' | 'error' } {
  if (isHealthy) return { label: 'Saudável', type: 'success' };
  if (isPhyto) return { label: 'Fatores abióticos', type: 'warning' };

  const nivel = details.doenca?.nivelSeveridade ?? 1;
  if (nivel <= 2) return { label: 'Severidade baixa', type: 'success' };
  if (nivel <= 3) return { label: 'Severidade média', type: 'warning' };
  return { label: 'Severidade alta', type: 'error' };
}

export const DiagnosisCard: React.FC<DiagnosisCardProps> = ({ attachment, details, isValidating }) => {
  const { diseaseId, confidence } = attachment.cvResult;
  const isHealthy = diseaseId === 'Saudável';
  const isPhyto = diseaseId === 'Fitotoxicidade';
  const isDoenca = !isHealthy && !isPhyto;
  const sev = severidade(details, isHealthy, isPhyto);
  const cv = details.crossValidation;
  const prioridade = getCrossValidationPriority(confidence, cv.status);
  const nomeLocal = details.doenca?.nomeComum ?? 'doença identificada';

  const titulo = isHealthy
    ? 'Nenhuma doença detectada'
    : isPhyto
      ? 'Dano abiótico / Fitotoxicidade'
      : (details.doenca?.nomeComum ?? 'Doença não catalogada');

  return (
    <View style={styles.card}>
      <Image source={{ uri: attachment.imageUri }} style={styles.foto} resizeMode="cover" />

      <View style={styles.corpo}>
        <View style={styles.cabecalho}>
          <View style={styles.tituloBloco}>
            <Text style={styles.titulo}>{titulo}</Text>
            {isDoenca && details.doenca?.nomeCientifico ? (
              <Text style={styles.cientifico}>{details.doenca.nomeCientifico}</Text>
            ) : null}
            <Text style={styles.confianca}>
              {Math.round(confidence * 100)}% de confiança do modelo local
            </Text>
          </View>
          <Badge text={sev.label} type={sev.type} />
        </View>

        {isDoenca && isValidating ? (
          <View style={styles.validando}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <Text style={styles.validandoTexto}>Consultando o Agrônomo IA…</Text>
          </View>
        ) : null}

        {isDoenca && !isValidating && cv.status === 'SKIPPED' ? (
          <Text style={styles.indisponivel}>
            Segunda opinião indisponível. O diagnóstico local continua válido.
          </Text>
        ) : null}

        {isDoenca && (cv.status === 'CONFIRMED' || cv.status === 'ENRICHED' || cv.status === 'DIVERGENT') ? (
          <View style={[styles.veredito, cv.status === 'DIVERGENT' && styles.vereditoDivergente]}>
            <Text style={styles.vereditoTitulo}>
              {cv.status === 'CONFIRMED'
                ? '✅ Diagnóstico confirmado'
                : cv.status === 'ENRICHED'
                  ? '💡 Diagnóstico enriquecido'
                  : '⚠️ As análises divergiram'}
            </Text>

            {prioridade.showBoth ? (
              <View style={styles.opinioes}>
                <Text style={styles.opiniao}>
                  🔬 Modelo local: {nomeLocal} ({Math.round(confidence * 100)}%)
                  {prioridade.primary === 'CV' ? ' • resultado primário' : ''}
                </Text>
                <Text style={styles.opiniao}>
                  ☁️ Agrônomo IA: {cv.llmDoencaNome ?? 'outra hipótese'}
                  {cv.llmConfianca !== null ? ` (${Math.round(cv.llmConfianca * 100)}%)` : ''}
                  {prioridade.primary === 'LLM' ? ' • sugestão primária' : ''}
                </Text>
                <Text style={styles.avisoDivergencia}>
                  As duas opiniões permanecem visíveis. Consulte um engenheiro agrônomo para confirmar.
                </Text>
              </View>
            ) : null}

            {cv.llmObservacoes ? <Text style={styles.observacoes}>{cv.llmObservacoes}</Text> : null}
          </View>
        ) : null}

        {isHealthy ? (
          <Text style={styles.especial}>
            A folha analisada não apresenta lesão identificável. Continue monitorando a lavoura
            periodicamente.
          </Text>
        ) : null}

        {isPhyto ? (
          <Text style={styles.especial}>
            Os sintomas indicam dano abiótico — queimadura por mistura ou dosagem equivocada de
            defensivos, ou estresse ambiental. Não é doença e não há defensivo indicado.{'\n\n'}
            Avalie o histórico de aplicações recentes com um engenheiro agrônomo.
          </Text>
        ) : null}

        {isDoenca ? (
          <View>
            {details.doenca?.causa ? (
              <View style={styles.secao}>
                <Text style={styles.secaoTitulo}>Agente causal</Text>
                <Text style={styles.secaoCorpo}>{details.doenca.causa}</Text>
              </View>
            ) : null}

            <View style={styles.secao}>
              <Text style={styles.secaoTitulo}>Sintomas característicos</Text>
              <Text style={styles.secaoCorpo}>
                {details.doenca?.sintomas ?? 'Sintomas não documentados no catálogo local.'}
              </Text>
            </View>

            <View style={styles.secao}>
              <Text style={styles.secaoTitulo}>Tratamentos recomendados</Text>
              {details.defensivos.length === 0 ? (
                <Text style={styles.secaoCorpo}>
                  Nenhum defensivo catalogado para esta doença no banco local.
                </Text>
              ) : (
                details.defensivos.map((d) => <DefensivoItem key={d.id} defensivo={d} />)
              )}
            </View>

            <Text style={styles.avisoLegal}>{AVISO_LEGAL}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surfaceLight,
    borderRadius: theme.borderRadius.lg,
    overflow: 'hidden',
    maxWidth: '92%',
  },
  foto: { width: '100%', aspectRatio: 4 / 3, backgroundColor: theme.colors.border },
  corpo: { padding: theme.spacing.md },
  cabecalho: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm },
  tituloBloco: { flex: 1 },
  titulo: { color: theme.colors.text, fontSize: theme.typography.fontSize.lg, fontWeight: '700' },
  cientifico: { color: theme.colors.textSecondary, fontSize: theme.typography.fontSize.xs, fontStyle: 'italic' },
  confianca: { color: theme.colors.textSecondary, fontSize: theme.typography.fontSize.xs, marginTop: 4 },
  validando: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginTop: theme.spacing.md },
  validandoTexto: { color: theme.colors.textSecondary, fontSize: theme.typography.fontSize.sm },
  indisponivel: { color: theme.colors.textSecondary, fontSize: theme.typography.fontSize.xs, marginTop: theme.spacing.md },
  veredito: {
    marginTop: theme.spacing.md,
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.primaryLight10,
  },
  vereditoDivergente: { backgroundColor: theme.colors.warning + '20' },
  vereditoTitulo: { color: theme.colors.text, fontSize: theme.typography.fontSize.sm, fontWeight: '700' },
  opinioes: { marginTop: theme.spacing.sm, gap: 4 },
  opiniao: { color: theme.colors.text, fontSize: theme.typography.fontSize.xs },
  avisoDivergencia: { color: theme.colors.warning, fontSize: theme.typography.fontSize.xs, fontWeight: '600', marginTop: 4 },
  observacoes: { color: theme.colors.text, fontSize: theme.typography.fontSize.xs, marginTop: theme.spacing.sm },
  especial: { color: theme.colors.text, fontSize: theme.typography.fontSize.sm, marginTop: theme.spacing.md, lineHeight: 20 },
  secao: { marginTop: theme.spacing.md },
  secaoTitulo: { color: theme.colors.text, fontSize: theme.typography.fontSize.sm, fontWeight: '700' },
  secaoCorpo: { color: theme.colors.text, fontSize: theme.typography.fontSize.sm, marginTop: 4, lineHeight: 20 },
  avisoLegal: {
    color: theme.colors.error,
    fontSize: theme.typography.fontSize.xs,
    marginTop: theme.spacing.md,
    lineHeight: 16,
  },
});
