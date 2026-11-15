import React from 'react';
import { View, Text, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { theme } from '../config/theme';
import { interpretarMarkdown, type Trecho } from '../lib/markdownBasico';

interface TextoFormatadoProps {
  texto: string;
  /** Estilo de texto base (cor, tamanho, altura de linha). */
  style?: StyleProp<TextStyle>;
}

function Trechos({ trechos }: { trechos: Trecho[] }) {
  return (
    <>
      {trechos.map((t, i) => (
        <Text key={i} style={t.negrito ? styles.negrito : undefined}>
          {t.texto}
        </Text>
      ))}
    </>
  );
}

export const TextoFormatado: React.FC<TextoFormatadoProps> = ({ texto, style }) => {
  const blocos = interpretarMarkdown(texto);
  return (
    <View style={styles.coluna}>
      {blocos.map((b, i) =>
        b.tipo === 'item' ? (
          <View key={i} style={styles.item}>
            <Text style={style}>{b.marcador}</Text>
            <Text style={[style, styles.itemTexto]}>
              <Trechos trechos={b.trechos} />
            </Text>
          </View>
        ) : (
          <Text key={i} style={[style, b.tipo === 'titulo' && styles.negrito]}>
            <Trechos trechos={b.trechos} />
          </Text>
        )
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  coluna: { gap: theme.spacing.xs },
  negrito: { fontWeight: '700' },
  item: { flexDirection: 'row', gap: theme.spacing.sm, paddingLeft: theme.spacing.sm },
  itemTexto: { flex: 1 },
});
