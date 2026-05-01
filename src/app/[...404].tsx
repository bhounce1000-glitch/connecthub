import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton } from '../components/ui/app-button';

export default function NotFound() {
  const router = useRouter();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>404 - Page Not Found</Text>
      <Text style={styles.subtitle}>Sorry, the page you requested does not exist.</Text>
      <AppButton title="Go Home" onPress={() => router.replace('/home')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#222',
  },
  subtitle: {
    fontSize: 18,
    color: '#666',
    marginBottom: 24,
    textAlign: 'center',
  },
});
