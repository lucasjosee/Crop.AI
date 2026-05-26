import React, { useState } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  TextInputProps, 
  StyleSheet, 
  TouchableOpacity 
} from 'react-native';
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
      <Text style={[styles.label, error ? styles.labelError : isFocused && styles.labelFocused]}>
        {label}
      </Text>
      
      <View style={[
        styles.inputWrapper,
        isFocused && styles.inputWrapperFocused,
        error && styles.inputWrapperError,
      ]}>
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
          >
            <Text style={styles.toggleText}>
              {isPasswordVisible ? 'Ocultar' : 'Mostrar'}
            </Text>
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
    marginBottom: theme.spacing.md,
    width: '100%',
  },
  label: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xs,
    fontWeight: '600',
  },
  labelFocused: {
    color: theme.colors.primary,
  },
  labelError: {
    color: theme.colors.error,
  },
  inputWrapper: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceLight,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.md,
  },
  inputWrapperFocused: {
    borderColor: theme.colors.primary,
  },
  inputWrapperError: {
    borderColor: theme.colors.error,
  },
  input: {
    flex: 1,
    height: '100%',
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.md,
  },
  toggleButton: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: theme.spacing.sm,
  },
  toggleText: {
    color: theme.colors.primary,
    fontSize: theme.typography.fontSize.xs,
    fontWeight: 'bold',
  },
  errorText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.error,
    marginTop: theme.spacing.xs,
  },
});
