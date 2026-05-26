export const theme = {
  colors: {
    background: '#FFFFFF',      // Clean pure white background (spec requirement)
    surface: '#FFFFFF',         // Pure white cards and sheets
    surfaceLight: '#F5F5F5',    // Very light grey for input backgrounds
    primary: '#2E7D32',         // Forest green (Mockup accent)
    primaryDark: '#1B5E20',     // Dark green for active states
    primaryLight: '#4CAF50',    // Light green
    primaryLight10: '#E8F5E9',  // 10% opacity primary (Forest green) background highlight
    text: '#212121',            // Almost black text (#212121)
    textSecondary: '#616161',   // Mid grey text (#616161)
    border: '#E0E0E0',          // Soft divider grey
    borderInactive: '#424242',    // Lead Grey for inactive inputs
    borderOutline: '#BDBDBD',     // Light Grey Outline for secondary/social buttons
    borderActive: '#2E7D32',    // Border color when focused/active
    error: '#D32F2F',           // Error red
    warning: '#F57C00',         // Burnt Orange for offline pending status
    success: '#81C784',         // Sync completed light green
    info: '#1976D2',            // Informative blue
    disabled: '#E0E0E0',        // Disabled state background
    shadow: '#000000',          // Shadow color
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  borderRadius: {
    sm: 4,
    md: 8,
    lg: 12,
    xl: 20,
    round: 9999,
  },
  typography: {
    fontFamily: {
      regular: 'System',
      medium: 'System',
      bold: 'System',
    },
    fontSize: {
      xxs: 10,
      xs: 12,
      sm: 14,
      md: 16,
      lg: 18,
      xl: 20,
      xxl: 24,
      title: 32,
    },
  },
};
