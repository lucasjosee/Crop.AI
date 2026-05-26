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
    setErrors({});
    
    // Validate inputs locally
    const result = loginSchema.safeParse({ email, password });
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
      await login(email, password);
      
      Toast.show({
        type: 'success',
        text1: 'Bem-vindo ao Crop.AI!',
        text2: 'Autenticação realizada com sucesso.',
      });
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

  const handleForgotPassword = () => {
    Toast.show({
      type: 'info',
      text1: 'Recuperação de Senha',
      text2: 'A recuperação de senha foi enviada para o seu e-mail (Simulação).',
    });
  };

  const handleSocialLogin = (platform: string) => {
    Toast.show({
      type: 'info',
      text1: `Login com ${platform}`,
      text2: `Autenticação com ${platform} indisponível no ambiente offline.`,
    });
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
          <Text style={styles.title}>Crop.AI</Text>
          <Text style={styles.subtitle}>Seu assistente de lavoura inteligente</Text>
        </View>

        {/* Form Container */}
        <View style={styles.formContainer}>
          <Input
            label="E-mail do Produtor"
            placeholder="exemplo@fazenda.com"
            value={email}
            onChangeText={setEmail}
            error={errors.email}
            keyboardType="email-address"
            autoComplete="email"
            autoCapitalize="none"
          />

          <Input
            label="Senha de Acesso"
            placeholder="Sua senha de 8 dígitos"
            value={password}
            onChangeText={setPassword}
            error={errors.password}
            secureTextEntry
          />

          {/* Link: Esqueci minha senha */}
          <TouchableOpacity 
            onPress={handleForgotPassword}
            style={styles.forgotPasswordContainer}
            activeOpacity={0.7}
          >
            <Text style={styles.forgotPasswordText}>Esqueci minha senha</Text>
          </TouchableOpacity>

          {/* Primary CTA */}
          <Button
            title="Entrar"
            onPress={handleLogin}
            loading={loading}
            variant="primary"
            style={styles.submitBtn}
          />

          {/* Divider "ou" */}
          <View style={styles.dividerContainer}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>ou</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Social Logins */}
          <Button
            title="Continuar com Google"
            onPress={() => handleSocialLogin('Google')}
            variant="secondary"
            style={styles.socialBtn}
            icon={<Ionicons name="logo-google" size={20} color={theme.colors.text} />}
          />

          <Button
            title="Continuar com Apple"
            onPress={() => handleSocialLogin('Apple')}
            variant="secondary"
            style={styles.socialBtn}
            icon={<Ionicons name="logo-apple" size={20} color={theme.colors.text} />}
          />
        </View>

        {/* Footer Link */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Não tem uma conta? </Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/register')} activeOpacity={0.7}>
            <Text style={styles.footerLink}>Cadastre-se aqui</Text>
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
    color: theme.colors.primary,
    letterSpacing: 1.2,
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
  forgotPasswordContainer: {
    alignSelf: 'flex-end',
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    marginBottom: theme.spacing.md,
    marginTop: -theme.spacing.sm, // pull closer to password input
  },
  forgotPasswordText: {
    color: theme.colors.primary,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
  },
  submitBtn: {
    width: '100%',
    marginBottom: theme.spacing.lg,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: theme.spacing.md,
    width: '100%',
  },
  dividerLine: {
    flex: 1,
    height: 1.5,
    backgroundColor: theme.colors.borderOutline,
  },
  dividerText: {
    color: theme.colors.textSecondary,
    paddingHorizontal: theme.spacing.md,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
  },
  socialBtn: {
    width: '100%',
    marginBottom: theme.spacing.md,
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
