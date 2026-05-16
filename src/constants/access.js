export const USER_ROLES = {
  CUSTOMER: 'customer',
  PROVIDER: 'provider',
};

export const COMMISSION_RATE = parseFloat(process.env.EXPO_PUBLIC_COMMISSION_RATE || '0.10');

export const CATEGORY_ICONS = {
  'Plumbing': '🔧',
  'Electrical': '⚡',
  'Cleaning': '🧹',
  'Carpentry': '🪚',
  'Painting': '🎨',
  'Moving & Transport': '🚛',
  'Gardening & Landscaping': '🌿',
  'Tech & IT Support': '💻',
  'Tutoring & Teaching': '📚',
  'Tailoring & Fashion': '🧵',
  'Cooking & Catering': '🍳',
  'Security': '🔒',
  'Other': '✨',
};

export const REQUEST_STATUS = {
  OPEN: 'open',
  ACCEPTED: 'accepted',
  IN_PROGRESS: 'in_progress',
  PENDING_CONFIRMATION: 'pending_confirmation',
  COMPLETED: 'completed',
  PAID: 'paid',
  DISPUTED: 'disputed',
  CANCELLED: 'cancelled',
};

export const STATUS_LABELS = {
  [REQUEST_STATUS.OPEN]: 'Open',
  [REQUEST_STATUS.ACCEPTED]: 'Accepted',
  [REQUEST_STATUS.IN_PROGRESS]: 'In Progress',
  [REQUEST_STATUS.PENDING_CONFIRMATION]: 'Pending Confirmation',
  [REQUEST_STATUS.COMPLETED]: 'Completed',
  [REQUEST_STATUS.PAID]: 'Paid',
  [REQUEST_STATUS.DISPUTED]: 'Disputed',
  [REQUEST_STATUS.CANCELLED]: 'Cancelled',
};

export const KYC_STATUS = {
  NOT_SUBMITTED: 'not_submitted',
  PENDING_VERIFICATION: 'pending_verification',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
};

// ADMIN LOGIN ACCOUNT — do not change this to support email
const adminEmailList = (process.env.EXPO_PUBLIC_ADMIN_EMAILS || 'bhounce1000@gmail.com')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

export const isAdminEmail = (email) => {
  if (!email) {
    return false;
  }

  return adminEmailList.includes(String(email).trim().toLowerCase());
};
