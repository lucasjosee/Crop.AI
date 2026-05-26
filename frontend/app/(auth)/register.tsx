import React, { useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { z } from 'zod';
import Toast from 'react-native-toast-message';
import { useAuthStore } from '../../store/useAuthStore';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { theme } from '../../config/theme';

const registerSchema = z.object({
  nome: z.string().trim().min(2, 'O nome deve conter pelo menos 2 caracteres').max(100, 'Máximo de 100 caracteres'),
  email: z.string().trim().email('Insira um e-mail válido'),
  password: z.string().min(8, 'A senha deve conter no mínimo 8 caracteres'),
});

export default function RegisterScreen() {
  const router = useRouter();
  const { register } = useAuthStore();
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ nome?: string; email?: string; password?: string }>({});
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    setErrors({});
    
    // Validar localmente com Zod
    const result = registerSchema.safeParse({ nome, email, password });
    if (!result.success) {
      const formattedErrors: any = {};
      result.error.errors.forEach((err) => {
        formattedErrors[err.path[0]] = err.message;
      });
      setErrors(formattedErrors);
      return;
    }

    try {
      setLoading(true);
      await register(nome, email, password);
      
      Toast.show({
        type: 'success',
        text1: 'Conta criada com sucesso!',
        text2: 'Faça login para continuar.',
      });
      
      // Redireciona para o Login
      router.replace('/(auth)/login');
    } catch (err: any) {
      const apiError = err.response?.data?.error;
      const errorMessage = apiError?.message || 'Falha ao realizar cadastro. Verifique a rede.';
      
      Toast.show({
        type: 'error',
        text1: 'Erro de Cadastro',
        text2: errorMessage,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>Crie sua conta</Text>
          <Text style={styles.subtitle}>Junte-se à plataforma inteligente Crop.AI</Text>
        </View>

        <View style={styles.formCard}>
          <Input
            label="Nome Completo do Produtor"
            placeholder="João da Silva"
            value={nome}
            onChangeText={setNome}
            error={errors.nome}
            autoComplete="name"
          />

          <Input
            label="E-mail de Trabalho"
            placeholder="exemplo@fazenda.com"
            value={email}
            onChangeText={setEmail}
            error={errors.email}
            keyboardType="email-address"
            autoComplete="email"
          />

          <Input
            label="Defina uma Senha"
            placeholder="Mínimo 8 caracteres"
            value={password}
            onChangeText={setPassword}
            error={errors.password}
            secureTextEntry
          />

          <Button
            title="Concluir Cadastro"
            onPress={handleRegister}
            loading={loading}
            style={styles.submitBtn}
          />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Já possui uma conta ativa?</Text>
          <Button
            title="Fazer Login"
            onPress={() => router.push('/(auth)/login')}
            variant="secondary"
            style={styles.loginBtn}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  header: {
    alignItems: 'center',
    marginBottom: theme.spacing.xl,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  subtitle: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: theme.spacing.xs,
  },
  formCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
  },
  submitBtn: {
    marginTop: theme.spacing.sm,
  },
  footer: {
    alignItems: 'center',
    marginTop: theme.spacing.xl,
  },
  footerText: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.fontSize.sm,
    marginBottom: theme.spacing.sm,
  },
  loginBtn: {
    width: '100%',
  },
});
