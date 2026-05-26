import { View, Text, StyleSheet } from 'react-native';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>App de Diagnóstico de Plantas</Text>
      <Text style={styles.subtitle}>O scaffold do projeto foi inicializado!</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1E1E1E', // Modo escuro agrícola base
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#E6F4FE',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#8CA5A6',
  },
});
