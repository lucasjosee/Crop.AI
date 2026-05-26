import React, { useState } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  TextInputProps, 
  StyleSheet, 
  TouchableOpacity 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../config/theme';

interface InputProps extends TextInputProps {
  label: string;
  error?: string;
  secureTextEntry?: boolean;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  secureTextEntry,
  style,
  onFocus,
  onBlur,
  ...props
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  const handleFocus = (e: any) => {
    setIsFocused(true);
    if (onFocus) onFocus(e);
  };

  const handleBlur = (e: any) => {
    setIsFocused(false);
    if (onBlur) onBlur(e);
  };

  const isPassword = secureTextEntry;

  return (
    <View style={styles.container}>
      <View style={[
        styles.inputWrapper,
        isFocused && styles.inputWrapperFocused,
        error && styles.inputWrapperError,
      ]}>
        {/* Label embutido que corta a borda superior */}
        <Text style={[
          styles.label, 
          error ? styles.labelError : isFocused && styles.labelFocused
        ]}>
          {label}
        </Text>
        
        <TextInput
          style={[styles.input, style]}
          placeholderTextColor={theme.colors.textSecondary}
          secureTextEntry={isPassword && !isPasswordVisible}
          onFocus={handleFocus}
          onBlur={handleBlur}
          autoCapitalize={isPassword ? 'none' : props.autoCapitalize}
          {...props}
        />
        
        {isPassword && (
          <TouchableOpacity 
            onPress={() => setIsPasswordVisible(!isPasswordVisible)}
            style={styles.toggleButton}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} // Garante área de toque mínima de 48x48 dp
          >
            <Ionicons 
              name={isPasswordVisible ? 'eye-off-outline' : 'eye-outline'} 
              size={24} 
              color={theme.colors.textSecondary} 
            />
          </TouchableOpacity>
        )}
      </View>
      
      {error && (
        <Text style={styles.errorText}>
          {error}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: theme.spacing.lg, // Mais espaçamento conforme mockup
    width: '100%',
    position: 'relative',
    marginTop: theme.spacing.sm, // Espaço para a label flutuante superior
  },
  label: {
    position: 'absolute',
    top: -10,
    left: 12,
    backgroundColor: theme.colors.surface, // Fundo branco que corta a borda do input box
    paddingHorizontal: 6,
    zIndex: 1,
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textSecondary, // Medium Grey
    fontWeight: '600',
  },
  labelFocused: {
    color: theme.colors.primary, // #2E7D32 Forest Green
  },
  labelError: {
    color: theme.colors.error,
  },
  inputWrapper: {
    height: 60, // Altura de 60 dp conforme especificado
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 2, // Borda espessa de 2px
    borderColor: theme.colors.borderInactive, // Lead Grey for inactive state
    borderRadius: theme.borderRadius.lg, // Raio de 12px
    paddingHorizontal: theme.spacing.md,
  },
  inputWrapperFocused: {
    borderColor: theme.colors.borderActive, // #2E7D32 Forest Green
  },
  inputWrapperError: {
    borderColor: theme.colors.error,
  },
  input: {
    flex: 1,
    height: '100%',
    color: theme.colors.text, // #212121 Almost Black Grey
    fontSize: theme.typography.fontSize.md,
  },
  toggleButton: {
    justifyContent: 'center',
    alignItems: 'center',
    height: 48, // Área de toque de 48dp de altura
    minWidth: 48, // Área de toque de 48dp de largura
    paddingLeft: theme.spacing.sm,
  },
  errorText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.error,
    marginTop: theme.spacing.xs,
    paddingLeft: theme.spacing.xs,
  },
});
