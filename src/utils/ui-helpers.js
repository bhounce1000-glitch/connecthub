import { Platform, ToastAndroid } from 'react-native';

/**
 * Show a toast message (Android) or alert (iOS)
 */
export function showToast(message, duration = 'SHORT') {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, duration === 'SHORT' ? ToastAndroid.SHORT : ToastAndroid.LONG);
  }
  // iOS users will need to dismiss manually or use a toast library
}

/**
 * Format relative time: "2h ago", "Yesterday", "3 May"
 */
export function formatRelativeTime(value) {
  if (!value) return 'Recently';
  
  let ms = 0;
  if (value?.seconds) {
    ms = value.seconds * 1000;
  } else if (typeof value === 'number') {
    ms = value;
  } else {
    const parsed = new Date(value).getTime();
    ms = Number.isFinite(parsed) ? parsed : 0;
  }
  
  if (!ms) return 'Recently';
  
  const now = new Date();
  const then = new Date(ms);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 1) return 'Yesterday';
  if (diffDays < 7) return then.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  
  return then.toLocaleDateString();
}

/**
 * Format time of day: "2:30 PM" for today, "Mon 2:30 PM" for this week
 */
export function formatTimeOfDay(value, isToday = false) {
  if (!value) return '';
  
  let ms = 0;
  if (value?.seconds) {
    ms = value.seconds * 1000;
  } else if (typeof value === 'number') {
    ms = value;
  } else {
    const parsed = new Date(value).getTime();
    ms = Number.isFinite(parsed) ? parsed : 0;
  }
  
  if (!ms) return '';
  
  const date = new Date(ms);
  const timeStr = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', meridiem: 'short' });
  
  if (isToday) return timeStr;
  
  return date.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + timeStr;
}

/**
 * Format price in GHS with proper formatting
 */
export function formatPrice(amount) {
  const num = parseFloat(amount || 0);
  if (!Number.isFinite(num)) return 'GHS 0.00';
  return `GHS ${num.toFixed(2)}`;
}

/**
 * Format large numbers: 1000 → 1K, 1000000 → 1M
 */
export function formatCompactNumber(num) {
  const n = parseFloat(num || 0);
  if (!Number.isFinite(n)) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

/**
 * Get initials from name
 */
export function getInitials(name = '') {
  return String(name || '')
    .split(' ')
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('')
    .slice(0, 2) || '?';
}

/**
 * Get first name from email or displayName
 */
export function getFirstName(emailOrName = '') {
  const str = String(emailOrName || '').trim();
  if (!str) return 'Friend';
  
  // If it's an email, extract part before @
  if (str.includes('@')) {
    return str.split('@')[0]
      .split('.')
      .map(p => p[0]?.toUpperCase() + p.slice(1))
      .join(' ');
  }
  
  // If it's a name, get first word
  return str.split(' ')[0] || 'Friend';
}

/**
 * Validate phone number format
 */
export function isValidPhone(phone) {
  const cleaned = String(phone || '').replace(/\D/g, '');
  return cleaned.length >= 10;
}

/**
 * Validate email format
 */
export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

/**
 * Validate minimum price (GHS 10)
 */
export function isValidPrice(price) {
  const num = parseFloat(price || 0);
  return Number.isFinite(num) && num >= 10;
}

/**
 * Parse Firestore timestamp
 */
export function parseTimestamp(value) {
  if (!value) return new Date(0);
  if (value?.seconds) return new Date(value.seconds * 1000);
  if (typeof value === 'number') return new Date(value);
  return new Date(value);
}

/**
 * Check if date is today
 */
export function isToday(date) {
  const d = parseTimestamp(date);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

/**
 * Group items by date
 */
export function groupByDate(items, dateKey = 'createdAt') {
  const groups = {};
  
  items.forEach(item => {
    const date = parseTimestamp(item[dateKey]);
    const dateStr = date.toLocaleDateString();
    
    if (!groups[dateStr]) {
      groups[dateStr] = [];
    }
    groups[dateStr].push(item);
  });
  
  return Object.entries(groups).map(([date, items]) => ({ date, items }));
}

/**
 * Debounce helper
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Safe async wrapper
 */
export function safeAsync(asyncFn) {
  return async (...args) => {
    try {
      return await asyncFn(...args);
    } catch (error) {
      console.error('Safe async error:', error);
      return null;
    }
  };
}
