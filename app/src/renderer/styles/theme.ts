import type { ThemeConfig } from 'antd';

// Apple-style theme configuration for Ant Design 5.x
export const appleTheme: ThemeConfig = {
  token: {
    // Primary colors
    colorPrimary: '#007AFF',
    colorSuccess: '#34C759',
    colorWarning: '#FF9500',
    colorError: '#FF3B30',
    colorInfo: '#007AFF',

    // Background colors
    colorBgContainer: '#FFFFFF',
    colorBgLayout: '#F8F8FA',
    colorBgElevated: '#FFFFFF',

    // Border colors
    colorBorder: '#E5E5EA',
    colorBorderSecondary: '#F2F2F7',

    // Text colors
    colorText: '#1D1D1F',
    colorTextSecondary: '#86868B',
    colorTextTertiary: '#AEAEB2',
    colorTextQuaternary: '#C7C7CC',

    // Border radius
    borderRadius: 8,
    borderRadiusLG: 12,
    borderRadiusSM: 6,
    borderRadiusXS: 4,

    // Font settings
    fontFamily:
      'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontSize: 14,
    fontSizeLG: 16,
    fontSizeSM: 12,
    fontSizeXL: 20,

    // Line height
    lineHeight: 1.5,
    lineHeightLG: 1.5,
    lineHeightSM: 1.5,

    // Control height
    controlHeight: 36,
    controlHeightLG: 44,
    controlHeightSM: 28,

    // Motion
    motionDurationFast: '0.1s',
    motionDurationMid: '0.2s',
    motionDurationSlow: '0.3s',
  },
  components: {
    Button: {
      borderRadius: 8,
      controlHeight: 36,
      paddingContentHorizontal: 16,
    },
    Card: {
      borderRadiusLG: 12,
      paddingLG: 16,
    },
    Input: {
      borderRadius: 8,
      controlHeight: 36,
    },
    Select: {
      borderRadius: 8,
      controlHeight: 36,
    },
    Modal: {
      borderRadiusLG: 16,
    },
    Menu: {
      itemBorderRadius: 8,
      itemMarginBlock: 4,
      itemMarginInline: 8,
    },
    List: {
      itemPadding: '12px 16px',
    },
    Progress: {
      defaultColor: '#007AFF',
    },
    Slider: {
      railBg: '#E5E5EA',
      trackBg: '#007AFF',
      handleColor: '#007AFF',
    },
    Tooltip: {
      borderRadius: 8,
    },
    Dropdown: {
      borderRadiusLG: 12,
    },
    Message: {
      borderRadiusLG: 12,
    },
  },
};

// CSS variable names for custom styling
export const cssVariables = {
  // Colors
  '--color-primary': '#007AFF',
  '--color-success': '#34C759',
  '--color-warning': '#FF9500',
  '--color-error': '#FF3B30',
  '--color-bg-main': '#F8F8FA',
  '--color-bg-card': '#FFFFFF',
  '--color-border': '#E5E5EA',
  '--color-text-primary': '#1D1D1F',
  '--color-text-secondary': '#86868B',
  '--color-text-tertiary': '#AEAEB2',

  // Spacing
  '--spacing-xs': '4px',
  '--spacing-sm': '8px',
  '--spacing-md': '16px',
  '--spacing-lg': '24px',
  '--spacing-xl': '32px',

  // Border radius
  '--radius-sm': '6px',
  '--radius-md': '8px',
  '--radius-lg': '12px',
  '--radius-xl': '16px',
  '--radius-2xl': '24px',

  // Shadows
  '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.05)',
  '--shadow-md': '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
  '--shadow-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1)',

  // Font families
  '--font-display': '"Plus Jakarta Sans", Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  '--font-body': 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',

  // Sidebar width
  '--sidebar-width': '280px',

  // Preview panel width
  '--preview-width': '420px',
};

export default appleTheme;
