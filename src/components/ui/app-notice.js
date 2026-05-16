import { Text, View } from 'react-native';

import { AppRadius, AppSpace } from '../../constants/design-tokens';

const TONE_STYLES = {
  info: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
    titleColor: '#4338ca',
    messageColor: '#4338ca',
  },
  success: {
    backgroundColor: '#ecfdf5',
    borderColor: '#86efac',
    titleColor: '#15803d',
    messageColor: '#15803d',
  },
  warning: {
    backgroundColor: '#fffbeb',
    borderColor: '#fcd34d',
    titleColor: '#b45309',
    messageColor: '#b45309',
  },
  error: {
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
    titleColor: '#dc2626',
    messageColor: '#b91c1c',
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