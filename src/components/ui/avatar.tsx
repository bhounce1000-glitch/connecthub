import { View, Image, Text } from 'react-native';
import { AppColors } from '../../constants/design-tokens';

export default function Avatar({
  src,
  email,
  size = 40,
  style,
}) {
  const initials = email
    ?.split('@')[0]
    ?.split('.')
    ?.map((part) => part[0])
    ?.join('')
    ?.toUpperCase()
    ?.slice(0, 2) || '?';

  const bgColor = `hsl(${email?.charCodeAt(0) * 7 % 360}, 70%, 50%)`;

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: src ? 'transparent' : bgColor,
          justifyContent: 'center',
          alignItems: 'center',
          overflow: 'hidden',
          borderWidth: 2,
          borderColor: AppColors.slate200,
        },
        style,
      ]}
    >
      {src ? (
        <Image
          source={{ uri: src }}
          style={{
            width: '100%',
            height: '100%',
            borderRadius: size / 2,
          }}
        />
      ) : (
        <Text
          style={{
            fontSize: size / 2.5,
            fontWeight: '700',
            color: '#fff',
          }}
        >
          {initials}
        </Text>
      )}
    </View>
  );
}
