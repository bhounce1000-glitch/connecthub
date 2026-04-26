import { Text, TextInput, View } from 'react-native';

import { AppColors, AppRadius, AppSpace, AppType } from '../../constants/design-tokens';

export default function AppInput({
  label,
  helper,
  error,
  containerStyle = null,
  inputStyle = null,
  multiline = false,
  editable = true,
  ...props
}) {
  return (
    <View style={[{ marginBottom: AppSpace.md }, containerStyle]}>
      {label ? (
        <Text
          style={{
            fontSize: AppType.body,
            fontWeight: '600',
            color: AppColors.ink900,
            marginBottom: AppSpace.xs,
          }}
        >
          {label}
        </Text>
      ) : null}

      <TextInput
        {...props}
        multiline={multiline}
        editable={editable}
        placeholderTextColor="#94a3b8"
        style={[
          {
            borderWidth: 1,
            borderColor: error ? '#f87171' : editable ? '#cbd5e1' : '#d1d5db',
            backgroundColor: editable ? AppColors.white : '#f1f5f9',
            paddingHorizontal: 12,
            paddingVertical: multiline ? 12 : 11,
            borderRadius: AppRadius.md,
            color: AppColors.ink900,
            minHeight: multiline ? 120 : undefined,
            textAlignVertical: multiline ? 'top' : 'center',
          },
          inputStyle,
        ]}
      />

      {error || helper ? (
        <Text style={{ color: error ? '#b91c1c' : AppColors.ink500, marginTop: AppSpace.xs, fontSize: 13 }}>
          {error || helper}
        </Text>
      ) : null}
    </View>
  );
}