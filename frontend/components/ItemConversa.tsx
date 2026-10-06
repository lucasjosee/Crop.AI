// frontend/components/ItemConversa.tsx
// A linha de uma conversa. Vive aqui porque a lista (`/chat`) e o bloco de
// resumo da Home mostram exatamente a mesma linha; duas cópias divergiriam.
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { SessionListItem } from '../lib/chatRepository';
import { dataRelativa, previewDaSessao } from '../lib/sessionListFormat';
import { theme } from '../config/theme';

interface ItemConversaProps {
  item: SessionListItem;
  onPress: () => void;
  /** Só a lista oferece renomear e apagar; a Home não edita conversa. */
  onLongPress?: () => void;
}

export function ItemConversa({ item, onPress, onLongPress }: ItemConversaProps) {
  return (
    <TouchableOpacity
      style={styles.item}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`Conversa ${item.title}`}
      accessibilityHint={
        onLongPress ? 'Toque para abrir, toque longo para renomear ou apagar' : 'Toque para abrir'
      }
    >
      <View style={styles.itemTexto}>
        <View style={styles.itemTopo}>
          {item.originDiagnosticLocalId ? <Text style={styles.marcaFoto}>📷</Text> : null}
          <Text style={styles.itemTitulo} numberOfLines={1}>
            {item.title}
          </Text>
        </View>
        <Text style={styles.itemPrevia} numberOfLines={1}>
          {previewDaSessao(item)}
        </Text>
      </View>
      <Text style={styles.itemData}>{dataRelativa(item.updatedAt)}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  itemTexto: { flex: 1 },
  itemTopo: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  marcaFoto: { fontSize: theme.typography.fontSize.sm },
  itemTitulo: {
    flex: 1,
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.md,
    fontWeight: '600',
  },
  itemPrevia: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.fontSize.sm,
    marginTop: 2,
  },
  itemData: { color: theme.colors.textSecondary, fontSize: theme.typography.fontSize.xs },
});
