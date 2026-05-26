import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle, TextStyle } from 'react-native';
import { theme } from '../config/theme';

interface BadgeProps {
  text: string;
  type?: 'success' | 'warning' | 'error' | 'info' | 'primary';
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export const Badge: React.FC<BadgeProps> = ({
  text,
  type = 'primary',
  style,
  textStyle,
}) => {
  const badgeStyles = [
    styles.badge,
    styles[type],
    style,
  ];

  const textStyles = [
    styles.text,
    styles[`${type}Text`],
    textStyle,
  ];

  return (
    <View style={badgeStyles}>
      <Text style={textStyles}>{text}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.round, // Pill-shape as per spec
    alignSelf: 'flex-start',
    justifyContent: 'center',
    alignItems: 'center',
  },
  primary: {
    backgroundColor: `${theme.colors.primary}20`,
  },
  success: {
    backgroundColor: `${theme.colors.success}20`,
  },
  warning: {
    backgroundColor: `${theme.colors.warning}20`,
  },
  error: {
    backgroundColor: `${theme.colors.error}20`,
  },
  info: {
    backgroundColor: `${theme.colors.info}20`,
  },
  text: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: 'bold',
  },
  primaryText: {
    color: theme.colors.primary,
  },
  successText: {
    color: theme.colors.success,
  },
  warningText: {
    color: theme.colors.warning,
  },
  errorText: {
    color: theme.colors.error,
  },
  infoText: {
    color: theme.colors.info,
  },
});
