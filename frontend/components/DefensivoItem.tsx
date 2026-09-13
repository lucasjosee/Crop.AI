import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { theme } from '../config/theme';
import type { DiagnosisDefensivo } from '../lib/diagnosisDetails';

interface DefensivoItemProps {
  defensivo: DiagnosisDefensivo;
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <View style={styles.linha}>
      <Text style={styles.rotulo}>{rotulo}</Text>
      <Text style={styles.valor}>{valor}</Text>
    </View>
  );
}

/**
 * A bula fica recolhida: dentro de uma bolha de conversa ela empurraria o
 * resto da tela para fora. O que decide a aplicação — dose e carência —
 * continua sempre visível.
 */
export const DefensivoItem: React.FC<DefensivoItemProps> = ({ defensivo }) => {
  const [bulaAberta, setBulaAberta] = useState(false);
  const { bula, bulaBruta } = defensivo;
  const temBula = bula !== null || bulaBruta !== null;

  return (
    <View style={styles.card}>
      <View style={styles.cabecalho}>
        <Text style={styles.nome}>{defensivo.nomeComercial}</Text>
        {defensivo.classe ? <Text style={styles.classe}>{defensivo.classe}</Text> : null}
      </View>

      {defensivo.ingredienteAtivo ? (
        <Linha rotulo="Ingrediente ativo" valor={defensivo.ingredienteAtivo} />
      ) : null}
      {defensivo.grupoQuimicoFrac ? (
        <Linha rotulo="Grupo FRAC" valor={defensivo.grupoQuimicoFrac} />
      ) : null}
      {defensivo.dosagemRecomendada ? (
        <Linha rotulo="Dosagem" valor={defensivo.dosagemRecomendada} />
      ) : null}
      {defensivo.carenciaDias !== null ? (
        <Linha rotulo="Carência" valor={`${defensivo.carenciaDias} dias`} />
      ) : null}
      {defensivo.maxAplicacoesCiclo > 0 ? (
        <Linha rotulo="Máx. aplicações" valor={`${defensivo.maxAplicacoesCiclo}x por ciclo`} />
      ) : null}

      {temBula ? (
        <TouchableOpacity
          onPress={() => setBulaAberta((aberta) => !aberta)}
          accessibilityRole="button"
          accessibilityLabel={bulaAberta ? 'Recolher a bula' : 'Ver a bula'}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.verBula}>{bulaAberta ? '▾ recolher bula' : '▸ ver bula'}</Text>
        </TouchableOpacity>
      ) : null}

      {bulaAberta && bula ? (
        <View style={styles.bula}>
          {bula.modoDeAcao ? <Linha rotulo="Modo de ação" valor={bula.modoDeAcao} /> : null}
          {bula.epocaAplicacao ? <Linha rotulo="Época de aplicação" valor={bula.epocaAplicacao} /> : null}
          {bula.volumeCalda ? <Linha rotulo="Volume de calda" valor={bula.volumeCalda} /> : null}
          {bula.episExigidos && bula.episExigidos.length > 0 ? (
            <Linha rotulo="EPIs necessários" valor={bula.episExigidos.join(', ')} />
          ) : null}
          {bula.restricoesAmbientais ? (
            <Linha rotulo="Restrições ambientais" valor={bula.restricoesAmbientais} />
          ) : null}
        </View>
      ) : null}

      {bulaAberta && bulaBruta ? (
        <View style={styles.bula}>
          <Text style={styles.valor}>{bulaBruta}</Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  cabecalho: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  nome: { color: theme.colors.text, fontSize: theme.typography.fontSize.md, fontWeight: '700', flex: 1 },
  classe: { color: theme.colors.textSecondary, fontSize: theme.typography.fontSize.xs },
  linha: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4, gap: 4 },
  rotulo: { color: theme.colors.textSecondary, fontSize: theme.typography.fontSize.xs, fontWeight: '600' },
  valor: { color: theme.colors.text, fontSize: theme.typography.fontSize.xs, flexShrink: 1 },
  verBula: { color: theme.colors.primary, fontSize: theme.typography.fontSize.xs, fontWeight: '600', marginTop: theme.spacing.sm },
  bula: { marginTop: 4, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: theme.spacing.sm },
});
