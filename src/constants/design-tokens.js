/**
 * ConnectHub Design System
 * Comprehensive, professional design tokens for a cohesive visual language
 */

export const Colors = {
  // Brand - Professional blue palette
  primary: '#1d4ed8',        // Rich professional blue
  primaryDark: '#1e3a8a',    // Deep navy for headers
  primaryLight: '#3b82f6',   // Lighter blue for accents
  primarySurface: '#eff6ff', // Very light blue background
  brandNavy: '#08111f',
  brandInk: '#101828',
  brandGold: '#f59e0b',
  brandTeal: '#0f766e',
  
  // Semantic Colors
  success: '#059669',        // Professional green
  successLight: '#d1fae5',   // Light green surface
  warning: '#d97706',        // Amber warning
  warningLight: '#fef3c7',   // Light amber surface
  error: '#dc2626',          // Red for errors
  errorLight: '#fee2e2',     // Light red surface
  info: '#0891b2',           // Cyan for info
  infoLight: '#e0f2fe',      // Light cyan surface
  
  // Neutrals - Professional grayscale
  ink900: '#0f172a',         // Near black for headings
  ink800: '#1e293b',         // Dark for body text
  ink700: '#334155',         // Medium dark text
  ink600: '#475569',         // Secondary text
  ink500: '#64748b',         // Placeholder text
  ink400: '#94a3b8',         // Disabled text
  ink300: '#cbd5e1',         // Borders
  ink200: '#e2e8f0',         // Light borders
  ink100: '#f1f5f9',         // Light surfaces
  ink50:  '#f8fafc',         // Page background
  white:  '#ffffff',

  // Compatibility aliases used across existing screens
  slate50: '#f8fafc',
  slate100: '#f1f5f9',
  slate200: '#e2e8f0',
  slate300: '#cbd5e1',
  slate500: '#64748b',
  slate700: '#334155',
  slate900: '#0f172a',
  neutral900: '#111827',
  blue50: '#eff6ff',
  blue100: '#dbeafe',
  blue600: '#2563eb',
  blue700: '#1d4ed8',
  indigo50: '#eef2ff',
  indigo600: '#4f46e5',
  green50: '#f0fdf4',
  green100: '#dcfce7',
  green600: '#16a34a',
  green700: '#15803d',
  teal50: '#f0fdfa',
  teal700: '#0f766e',
  amber50: '#fffbeb',
  amber100: '#fef3c7',
  amber600: '#d97706',
  rose50: '#fff1f2',
  rose700: '#be123c',
  
  // Status badges - Semantic job states
  statusOpen: '#2563eb',
  statusAccepted: '#ea580c',
  statusWorking: '#7c3aed',
  statusConfirm: '#d97706',
  statusPaid: '#059669',
  statusCancelled: '#64748b',
  statusDisputed: '#dc2626',
  
  // Subscription tiers
  tierFree: '#64748b',
  tierPro: '#2563eb',
  tierPremium: '#d97706',
  
  // Avatar palette (8 colors, deterministic by email char)
  avatar: [
    '#2563eb', '#7c3aed', '#db2777', '#dc2626',
    '#ea580c', '#059669', '#0891b2', '#4f46e5'
  ]
};

export const Typography = {
  // Font sizes
  xs: 11,
  sm: 13,
  base: 15,
  md: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 36,
  
  // Font weights
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
  black: '900',
  
  // Line heights
  lineHeightTight: 1.25,
  lineHeightNormal: 1.5,
  lineHeightRelaxed: 1.75
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 48,
  '6xl': 64
};

export const Radius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 24,
  xxl: 24,
  pill: 9999,
  full: 9999
};

export const Shadow = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 4
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8
  },
  card: {
    shadowColor: '#1d4ed8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3
  }
};

/**
 * Helper: Get deterministic avatar color from email
 * @param {string} email - User email address
 * @returns {string} Hex color code
 */
export function getAvatarColor(email) {
  if (!email) return Colors.avatar[0];
  return Colors.avatar[String(email).charCodeAt(0) % Colors.avatar.length];
}

/**
 * Helper: Get status color based on job status
 * @param {string} status - Job/request status
 * @returns {string} Hex color code
 */
export function getStatusColor(status) {
  const s = (status || '').toUpperCase();
  if (s === 'OPEN') return Colors.statusOpen;
  if (s === 'ACCEPTED') return Colors.statusAccepted;
  if (['IN_PROGRESS', 'WORKING'].includes(s)) return Colors.statusWorking;
  if (['PENDING_CONFIRMATION', 'CONFIRM'].includes(s)) return Colors.statusConfirm;
  if (['PAID', 'COMPLETED'].includes(s)) return Colors.statusPaid;
  if (s === 'CANCELLED') return Colors.statusCancelled;
  if (s === 'DISPUTED') return Colors.statusDisputed;
  return Colors.ink500;
}

/**
 * Helper: Format Ghana phone number for display
 * @param {string} phone - Phone number in various formats
 * @returns {string} Formatted phone number
 */
export function formatGhanaPhone(phone) {
  if (!phone) return '';
  const p = String(phone).replace(/\s/g, '');
  if (p.startsWith('+233')) return '0' + p.slice(4);
  if (p.startsWith('233')) return '0' + p.slice(3);
  return p;
}

/**
 * Helper: Format currency as Ghana cedis
 * @param {number} amount - Amount in cedis
 * @returns {string} Formatted currency string
 */
export function formatGHS(amount) {
  const n = parseFloat(amount || 0);
  return 'GHS ' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Helper: Format timestamp as relative time
 * @param {Date|Timestamp} timestamp - Firebase Timestamp or Date
 * @returns {string} Relative time string (e.g., "2h ago")
 */
export function timeAgo(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  if (seconds < 604800) return Math.floor(seconds / 86400) + 'd ago';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * Legacy exports for backward compatibility
 */
export const AppColors = Colors;
export const AppRadius = Radius;
export const AppSpace = Spacing;
export const AppType = {
  body: Typography.base,
  title: Typography.lg,
  heading: Typography['3xl'],
  overline: Typography.sm
};
export const AppShadow = Shadow;
