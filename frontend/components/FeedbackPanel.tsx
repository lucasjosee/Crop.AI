import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Toast from 'react-native-toast-message';
import { theme } from '../config/theme';
import { Button } from './Button';
import { queueDiagnosisFeedback } from '../lib/diagnosisFeedbackService';
import { listCatalogDiseases, type CatalogDisease, type DiagnosisDetails } from '../lib/diagnosisDetails';

type Escolha = 'CORRECT' | 'INCORRECT' | 'LLM' | 'OTHER';

interface FeedbackPanelProps {
  diagnosticLocalId: string;
  details: DiagnosisDetails;
  onSubmitted: () => void;
}

/**
 * RF06. Numa divergência os botões passam a nomear as duas hipóteses em vez
 * de "correto / incorreto": perguntar se o diagnóstico está certo quando os
 * dois modelos discordam não dá ao produtor como responder.
 */
export const FeedbackPanel: React.FC<FeedbackPanelProps> = ({
  diagnosticLocalId,
  details,
  onSubmitted,
}) => {
  const [escolha, setEscolha] = useState<Escolha | null>(null);
  const [correcaoId, setCorrecaoId] = useState<string | null>(null);
  const [observacoes, setObservacoes] = useState('');
  const [catalogo, setCatalogo] = useState<CatalogDisease[]>([]);
  const [enviando, setEnviando] = useState(false);

  const cv = details.crossValidation;
  const divergente = cv.status === 'DIVERGENT';
  const nomeLocal = details.doenca?.nomeComum ?? 'a opinião local';

  const escolherOutra = useCallback(async () => {
    setEscolha('OTHER');
    setCorrecaoId(null);
    if (catalogo.length === 0) {
      try {
        setCatalogo(await listCatalogDiseases());
      } catch {
        Toast.show({
          type: 'error',
          text1: 'Não foi possível carregar as doenças',
          text2: 'Tente de novo em instantes.',
        });
      }
    }
  }, [catalogo.length]);

  const enviar = useCallback(async () => {
    if (!escolha || enviando) return;
    if (escolha === 'OTHER' && !correcaoId) {
      Toast.show({
        type: 'info',
        text1: 'Selecione a doença',
        text2: 'Informe qual doença parece ser a correta.',
      });
      return;
    }

    setEnviando(true);
    try {
      // fila_feedbacks.corrected_doenca_id é FK para doencas(id), então uma
      // doença fora do catálogo local não cabe ali. O nome na nota é o único
      // carregador que sobra — e a divergência fora do catálogo é justamente o
      // caso mais valioso para melhorar os modelos.
      const notaDivergencia =
        escolha === 'LLM'
          ? `Produtor escolheu a opinião do Agrônomo IA${cv.llmDoencaNome ? `: ${cv.llmDoencaNome}` : ''}.`
          : '';
      await queueDiagnosisFeedback({
        diagnosticLocalId,
        isCorrect: escolha === 'CORRECT',
        correctedDoencaId:
          escolha === 'LLM' ? cv.llmDoencaId : escolha === 'OTHER' ? correcaoId : null,
        notes: [notaDivergencia, observacoes.trim()].filter(Boolean).join(' '),
      });
      Toast.show({
        type: 'success',
        text1: 'Feedback registrado',
        text2: 'Sua avaliação sobe na próxima sincronização.',
      });
      onSubmitted();
    } catch {
      Toast.show({
        type: 'error',
        text1: 'Erro ao registrar feedback',
        text2: 'Tente novamente em instantes.',
      });
    } finally {
      setEnviando(false);
    }
  }, [escolha, enviando, correcaoId, observacoes, cv.llmDoencaId, diagnosticLocalId, onSubmitted]);

  const botao = (valor: Escolha, texto: string, aoTocar?: () => void) => (
    <TouchableOpacity
      style={[styles.botao, escolha === valor && styles.botaoSelecionado]}
      onPress={aoTocar ?? (() => { setEscolha(valor); setCorrecaoId(null); })}
      accessibilityRole="button"
      accessibilityState={{ selected: escolha === valor }}
      accessibilityLabel={texto}
    >
      <Text style={styles.botaoTexto}>{texto}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.painel}>
      <Text style={styles.pergunta}>Este diagnóstico parece correto?</Text>

      <View style={styles.botoes}>
        {botao('CORRECT', divergente ? `É ${nomeLocal}` : 'Diagnóstico correto')}
        {divergente
          ? botao('LLM', `É ${cv.llmDoencaNome ?? 'a opinião do Agrônomo IA'}`)
          : botao('INCORRECT', 'Incorreto')}
        {botao('OTHER', 'Parece ser outra doença', escolherOutra)}
      </View>

      {escolha === 'OTHER' ? (
        <View style={styles.lista}>
          <Text style={styles.rotulo}>Selecione a correção:</Text>
          {catalogo.map((doenca) => (
            <TouchableOpacity
              key={doenca.id}
              style={[styles.opcao, correcaoId === doenca.id && styles.opcaoSelecionada]}
              onPress={() => setCorrecaoId(doenca.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: correcaoId === doenca.id }}
              accessibilityLabel={doenca.nomeComum}
            >
              <Text style={styles.opcaoTexto}>{doenca.nomeComum}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {escolha ? (
        <>
          <TextInput
            style={styles.observacoes}
            value={observacoes}
            onChangeText={setObservacoes}
            placeholder="Observações (opcional)"
            placeholderTextColor={theme.colors.textSecondary}
            multiline
            accessibilityLabel="Observações sobre o diagnóstico"
          />
          <Button
            title="Enviar feedback"
            onPress={enviar}
            loading={enviando}
            variant="secondary"
            style={styles.enviar}
          />
        </>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  painel: {
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  pergunta: { color: theme.colors.text, fontSize: theme.typography.fontSize.sm, fontWeight: '700' },
  botoes: { marginTop: theme.spacing.sm, gap: theme.spacing.xs },
  botao: {
    borderWidth: 1,
    borderColor: theme.colors.borderOutline,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  botaoSelecionado: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryLight10 },
  botaoTexto: { color: theme.colors.text, fontSize: theme.typography.fontSize.sm },
  lista: { marginTop: theme.spacing.sm, gap: theme.spacing.xs },
  rotulo: { color: theme.colors.textSecondary, fontSize: theme.typography.fontSize.xs },
  opcao: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.sm,
    paddingVertical: 6,
    paddingHorizontal: theme.spacing.sm,
  },
  opcaoSelecionada: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryLight10 },
  opcaoTexto: { color: theme.colors.text, fontSize: theme.typography.fontSize.xs },
  observacoes: {
    marginTop: theme.spacing.sm,
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.sm,
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.sm,
    minHeight: 60,
  },
  enviar: { marginTop: theme.spacing.sm },
});
