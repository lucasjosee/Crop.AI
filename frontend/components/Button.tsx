import { 
  TouchableOpacity, 
  Text, 
  ActivityIndicator, 
  StyleSheet, 
  StyleProp, 
  ViewStyle, 
  TextStyle,
  View
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
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
  textStyle,
  icon,
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
    styles[`${variant}Text`],
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
          color={variant === 'primary' ? '#FFFFFF' : theme.colors.primary} 
        />
      ) : (
        <>
          {icon && <View style={styles.iconContainer}>{icon}</View>}
          <Text style={textStyles}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  baseButton: {
    borderRadius: theme.borderRadius.round, // Mockup has pill/rounded shape buttons
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    flexDirection: 'row',
  },
  primary: {
    backgroundColor: theme.colors.primary, // #2E7D32 Forest Green
    height: 60,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: theme.colors.borderOutline, // Grey outline from mockup
    height: 56,
  },
  danger: {
    backgroundColor: theme.colors.error,
    height: 56,
  },
  disabled: {
    backgroundColor: '#E0E0E0',
    borderColor: '#E0E0E0',
  },
  baseText: {
    fontSize: theme.typography.fontSize.md,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  primaryText: {
    color: '#FFFFFF', // White text on Forest Green
  },
  secondaryText: {
    color: theme.colors.text, // Black text on white outline
  },
  dangerText: {
    color: '#FFFFFF',
  },
  disabledText: {
    color: '#9E9E9E',
  },
  iconContainer: {
    marginRight: theme.spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
export default Button;
