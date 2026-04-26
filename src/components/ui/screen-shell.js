import { ScrollView, Text, View } from 'react-native';

import { AppColors, AppRadius, AppSpace, AppType } from '../../constants/design-tokens';

export default function ScreenShell({
  eyebrow,
  title,
  subtitle,
  accentColor = AppColors.ink900,
  accentTextColor = AppColors.white,
  backgroundColor = AppColors.slate50,
  scroll = false,
  contentContainerStyle = null,
  children,
}) {
  const Container = scroll ? ScrollView : View;

  return (
    <Container
      style={{ flex: 1, backgroundColor }}
      contentContainerStyle={scroll ? [{ padding: AppSpace.lg }, contentContainerStyle] : undefined}
    >
      <View style={{ padding: AppSpace.lg, flex: scroll ? undefined : 1 }}>
        <View
          style={{
            backgroundColor: accentColor,
            borderRadius: AppRadius.xl,
            padding: AppSpace.lg,
            marginBottom: AppSpace.lg,
          }}
        >
          {eyebrow ? (
            <Text style={{ fontSize: AppType.overline, color: accentTextColor, fontWeight: '700', letterSpacing: 0.4, fontFamily: 'serif' }}>
              {eyebrow}
            </Text>
          ) : null}

          <Text style={{ fontSize: AppType.heading, fontWeight: '800', color: AppColors.white, marginTop: 4 }}>
            {title}
          </Text>

          {subtitle ? (
            <Text style={{ color: accentTextColor, marginTop: 6, lineHeight: 20 }}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        {children}
      </View>
    </Container>
  );
}