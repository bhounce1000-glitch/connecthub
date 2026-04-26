import { Text, View } from 'react-native';

import { AppRadius, AppSpace } from '../../constants/design-tokens';

const TONE_STYLES = {
  info: {
    backgroundColor: '#dbeafe',
    borderColor: '#93c5fd',
    titleColor: '#1d4ed8',
    messageColor: '#1e3a8a',
  },
  success: {
    backgroundColor: '#dcfce7',
    borderColor: '#86efac',
    titleColor: '#166534',
    messageColor: '#166534',
  },
  warning: {
    backgroundColor: '#fef3c7',
    borderColor: '#fcd34d',
    titleColor: '#92400e',
    messageColor: '#92400e',
  },
  error: {
    backgroundColor: '#fee2e2',
    borderColor: '#fca5a5',
    titleColor: '#b91c1c',
    messageColor: '#991b1b',
  },
};

export default function AppNotice({
  tone = 'info',
  title,
  message,
  style = null,
}) {
  if (!title && !message) {
    return null;
  }

  const colors = TONE_STYLES[tone] || TONE_STYLES.info;

  return (
    <View
      style={[
        {
          backgroundColor: colors.backgroundColor,
          borderColor: colors.borderColor,
          borderWidth: 1,
          borderRadius: AppRadius.md,
          padding: AppSpace.md,
          marginBottom: AppSpace.md,
        },
        style,
      ]}
    >
      {title ? (
        <Text style={{ color: colors.titleColor, fontWeight: '700', marginBottom: message ? AppSpace.xs : 0 }}>
          {title}
        </Text>
      ) : null}

      {message ? (
        <Text style={{ color: colors.messageColor, lineHeight: 20 }}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}