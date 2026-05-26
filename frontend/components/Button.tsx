import React from 'react';
import { 
  TouchableOpacity, 
  Text, 
  ActivityIndicator, 
  StyleSheet, 
  StyleProp, 
  ViewStyle, 
  TextStyle 
} from 'react-native';
import { theme } from '../config/theme';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
  textStyle,
}) => {
  const isButtonDisabled = disabled || loading;

  const buttonStyles = [
    styles.baseButton,
    styles[variant],
    isButtonDisabled && styles.disabled,
    style,
  ];

  const textStyles = [
    styles.baseText,
    variant === 'secondary' ? styles.secondaryText : styles.defaultText,
    isButtonDisabled && styles.disabledText,
    textStyle,
  ];

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      disabled={isButtonDisabled}
      style={buttonStyles}
    >
      {loading ? (
        <ActivityIndicator 
          size="small" 
          color={variant === 'secondary' ? theme.colors.primary : theme.colors.text} 
        />
      ) : (
        <Text style={textStyles}>{title}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  baseButton: {
    height: 48,
    borderRadius: theme.borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    flexDirection: 'row',
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  primary: {
    backgroundColor: theme.colors.primary,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: theme.colors.primary,
    shadowOpacity: 0,
    elevation: 0,
  },
  danger: {
    backgroundColor: theme.colors.error,
  },
  disabled: {
    backgroundColor: theme.colors.disabled,
    borderColor: theme.colors.disabled,
    shadowOpacity: 0,
    elevation: 0,
  },
  baseText: {
    fontSize: theme.typography.fontSize.md,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  defaultText: {
    color: theme.colors.background, // High contrast dark text on light primary/danger backgrounds
  },
  secondaryText: {
    color: theme.colors.primary,
  },
  disabledText: {
    color: theme.colors.textSecondary,
  },
});
