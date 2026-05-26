export const theme = {
  colors: {
    background: '#0E1612',      // Deep forest green, close to black
    surface: '#16221B',         // Subtle container green
    surfaceLight: '#223329',    // Input backgrounds and card headers
    primary: '#2ECC71',         // Active leaf green
    primaryDark: '#1E824C',     // Selected/pressed green
    primaryLight: '#82E0AA',    // Hover or highlights
    text: '#E6F4FE',            // High contrast off-white for title
    textSecondary: '#8CA5A6',   // Soft grey-green for subtitles/body
    border: '#273C30',          // Muted border color
    error: '#E74C3C',           // Critical alert red (e.g. disease severity 5)
    warning: '#E67E22',         // Medium warning orange (e.g. disease severity 3)
    success: '#2ECC71',         // Success states
    info: '#3498DB',            // Informative messages
    disabled: '#2E3E35',        // Disabled buttons/inputs
    shadow: '#060B08',          // Drop shadow color
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
