import { Stack, useRouter, type ErrorBoundaryProps } from 'expo-router';
import { Text, View } from 'react-native';

import AppButton from '../components/ui/app-button';

export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <RootErrorBoundary error={error} retry={retry} />;
}

function RootErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc', justifyContent: 'center', padding: 20 }}>
      <View style={{ backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', padding: 18 }}>
        <Text style={{ fontSize: 20, fontWeight: '800', color: '#0f172a', marginBottom: 8 }}>
          Something went wrong
        </Text>
        <Text style={{ fontSize: 14, color: '#475569', marginBottom: 14 }}>
          An unexpected app error occurred. You can retry this screen or return to the dashboard.
        </Text>
        {error?.message ? (
          <Text style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }} numberOfLines={4}>
            {error.message}
          </Text>
        ) : null}
        <View style={{ marginBottom: 10 }}>
          <AppButton label="Retry" onPress={retry} />
        </View>
        <AppButton label="Go to Home" variant="neutral" onPress={() => router.replace('/home')} />
      </View>
    </View>
  );
}