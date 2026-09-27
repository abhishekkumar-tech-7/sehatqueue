const tintColorLight = '#0F766E'; // calm teal - primary brand color
const tintColorDark = '#5EEAD4';

export default {
  light: {
    text: '#111827',
    background: '#FFFFFF',
    tint: tintColorLight,
    tabIconDefault: '#9CA3AF',
    tabIconSelected: tintColorLight,

    // Semantic colors - used across the whole app for consistency
    primary: '#0F766E',       // main buttons, active states
    primaryDark: '#115E59',   // pressed/hover state
    secondary: '#334155',     // secondary buttons, less prominent actions
    success: '#15803D',       // booking confirmed
    error: '#B91C1C',         // errors, cancellations
    warning: '#B45309',       // queue delays, important notices
    border: '#E5E7EB',
    cardBackground: '#F9FAFB',
    textMuted: '#6B7280',
  },
  dark: {
    text: '#F9FAFB',
    background: '#0F172A',
    tint: tintColorDark,
    tabIconDefault: '#6B7280',
    tabIconSelected: tintColorDark,

    primary: '#5EEAD4',
    primaryDark: '#2DD4BF',
    secondary: '#94A3B8',
    success: '#4ADE80',
    error: '#F87171',
    warning: '#FBBF24',
    border: '#1E293B',
    cardBackground: '#1E293B',
    textMuted: '#94A3B8',
  },
};
