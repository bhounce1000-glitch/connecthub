export function toDisplayDateTime(value) {
  if (!value) return '';

  let dateValue = null;

  if (value?.seconds) {
    dateValue = new Date(value.seconds * 1000);
  } else if (value instanceof Date) {
    dateValue = value;
  } else if (typeof value === 'number' || typeof value === 'string') {
    dateValue = new Date(value);
  }

  if (!dateValue || Number.isNaN(dateValue.getTime())) {
    return '';
  }

  return dateValue.toLocaleString();
}