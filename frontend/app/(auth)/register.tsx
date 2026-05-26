import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  KeyboardAvoidingView, 
  Platform, 
  ScrollView, 
  TouchableOpacity 
} from 'react-native';
import { useRouter } from 'expo-router';
import { z } from 'zod';
import Toast from 'react-native-toast-message';
import { Ionicons } from '@expo/vector-icons';
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
    
    // Validate inputs locally
    const result = registerSchema.safeParse({ nome, email, password });
    if (!result.success) {
      const formattedErrors: any = {};
      result.error.issues.forEach((err) => {
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
      <ScrollView 
        contentContainerStyle={styles.scrollContainer} 
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Central Logo and Subtitle */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <Ionicons name="leaf" size={64} color={theme.colors.primary} />
          </View>
          <Text style={styles.title}>Crie sua conta</Text>
          <Text style={styles.subtitle}>Junte-se à plataforma inteligente Crop.AI</Text>
        </View>

        {/* Form Container */}
        <View style={styles.formContainer}>
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
            autoCapitalize="none"
          />

          <Input
            label="Defina uma Senha"
            placeholder="Mínimo 8 caracteres"
            value={password}
            onChangeText={setPassword}
            error={errors.password}
            secureTextEntry
          />

          {/* Primary CTA */}
          <Button
            title="Concluir Cadastro"
            onPress={handleRegister}
            loading={loading}
            variant="primary"
            style={styles.submitBtn}
          />
        </View>

        {/* Footer Link */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Já possui uma conta ativa? </Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/login')} activeOpacity={0.7}>
            <Text style={styles.footerLink}>Fazer Login</Text>
          </TouchableOpacity>
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
  logoContainer: {
    marginBottom: theme.spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: theme.typography.fontSize.xxl + 4,
    fontWeight: '900',
    color: theme.colors.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: theme.typography.fontSize.md,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: theme.spacing.xs,
  },
  formContainer: {
    width: '100%',
  },
  submitBtn: {
    width: '100%',
    marginTop: theme.spacing.md,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: theme.spacing.xl,
    paddingBottom: theme.spacing.md,
  },
  footerText: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.fontSize.sm,
  },
  footerLink: {
    color: theme.colors.primary,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: 'bold',
    textDecorationLine: 'underline',
  },
});
