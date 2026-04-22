export const REQUEST_STATUS = {
  OPEN: 'open',
  ACCEPTED: 'accepted',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  PAID: 'paid',
  CANCELLED: 'cancelled',
};

export const STATUS_LABELS = {
  [REQUEST_STATUS.OPEN]: 'Open',
  [REQUEST_STATUS.ACCEPTED]: 'Accepted',
  [REQUEST_STATUS.IN_PROGRESS]: 'In Progress',
  [REQUEST_STATUS.COMPLETED]: 'Completed',
  [REQUEST_STATUS.PAID]: 'Paid',
  [REQUEST_STATUS.CANCELLED]: 'Cancelled',
};

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
