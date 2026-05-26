import React, { useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { z } from 'zod';
import Toast from 'react-native-toast-message';
import { useAuthStore } from '../../store/useAuthStore';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { theme } from '../../config/theme';

const loginSchema = z.object({
  email: z.string().trim().email('Insira um e-mail válido'),
  password: z.string().min(8, 'A senha deve conter no mínimo 8 caracteres'),
});

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    // Reset validations
    setErrors({});
    
    // Validate inputs locally
    const result = loginSchema.safeParse({ email, password });
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
      await login(email, password);
      
      Toast.show({
        type: 'success',
        text1: 'Bem-vindo ao Crop.AI!',
        text2: 'Autenticação realizada com sucesso.',
      });
      
      // O redirecionamento é controlado automaticamente pelo AuthGuard no layout principal.
    } catch (err: any) {
      const apiError = err.response?.data?.error;
      const errorMessage = apiError?.message || 'Falha ao conectar com o servidor. Verifique seu sinal.';
      
      Toast.show({
        type: 'error',
        text1: 'Erro de Login',
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
          <Text style={styles.title}>Crop.AI</Text>
          <Text style={styles.subtitle}>Diagnóstico e Manejo Agrícola de Precisão</Text>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Acesse sua conta</Text>
          
          <Input
            label="E-mail do Produtor"
            placeholder="exemplo@fazenda.com"
            value={email}
            onChangeText={setEmail}
            error={errors.email}
            keyboardType="email-address"
            autoComplete="email"
          />

          <Input
            label="Senha de Acesso"
            placeholder="Sua senha de 8 dígitos"
            value={password}
            onChangeText={setPassword}
            error={errors.password}
            secureTextEntry
          />

          <Button
            title="Entrar no Painel"
            onPress={handleLogin}
            loading={loading}
            style={styles.submitBtn}
          />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Ainda não tem uma conta?</Text>
          <Button
            title="Criar Nova Conta"
            onPress={() => router.push('/(auth)/register')}
            variant="secondary"
            style={styles.registerBtn}
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
    fontSize: 42,
    fontWeight: '900',
    color: theme.colors.primary,
    letterSpacing: 1.5,
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
  formTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
    textAlign: 'center',
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
  registerBtn: {
    width: '100%',
  },
});
