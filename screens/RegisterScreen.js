import { createUserWithEmailAndPassword } from 'firebase/auth';
import { useState } from 'react';
import { Button, Text, TextInput, View } from 'react-native';
import { auth } from '../firebase';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const registerUser = () => {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      alert('Please enter a valid email address.');
      return;
    }

    createUserWithEmailAndPassword(auth, normalizedEmail, password)
      .then(() => {
        alert('Account created');
        navigation.navigate('Home');
      })
      .catch(error => alert(error.message));
  };

  return (
    <View style={{ marginTop: 100, padding: 20 }}>
      <Text style={{ fontSize: 24 }}>Register</Text>

      <TextInput
        placeholder="Email"
        style={{ borderWidth: 1, marginBottom: 10 }}
        onChangeText={setEmail}
      />

      <TextInput
        placeholder="Password"
        style={{ borderWidth: 1, marginBottom: 20 }}
        secureTextEntry
        onChangeText={setPassword}
      />

      <Button title="Create Account" onPress={registerUser} />
    </View>
  );
}