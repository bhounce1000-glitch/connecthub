import { Text, View } from 'react-native';
import { getStatusColor, Radius } from '../constants/design-tokens';

const STATUS_LABELS = {
  OPEN: 'Open',
  ACCEPTED: 'Accepted',
  IN_PROGRESS: 'In Progress',
  WORKING: 'Working',
  PENDING_CONFIRMATION: 'Awaiting Confirm',
  COMPLETED: 'Completed',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
  DISPUTED: 'Disputed',
};

/**
 * Reusable status badge component
 * @param {object} props
 * @param {string} props.status - Status string (e.g., 'OPEN', 'ACCEPTED')
 * @param {string} props.size - Size variant: 'sm' or 'lg' (default: 'sm')
 */
export default function StatusBadge({ status, size = 'sm' }) {
  const color = getStatusColor(status);
  const label = STATUS_LABELS[(status || '').toUpperCase()] || status;
  const fontSize = size === 'sm' ? 11 : 13;
  
  return (
    <View
      style={{
        backgroundColor: color + '18', // 18% opacity
        borderWidth: 1,
        borderColor: color + '40', // 40% opacity
        borderRadius: Radius.full,
        paddingHorizontal: 10,
        paddingVertical: 3,
        alignSelf: 'flex-start',
      }}
      accessible={true}
      accessibilityLabel={`Status: ${label}`}
    >
      <Text
        style={{
          color,
          fontSize,
          fontWeight: '600',
        }}
      >
        {label}
      </Text>
    </View>
  );
}
