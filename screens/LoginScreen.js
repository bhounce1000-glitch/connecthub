import { signInWithEmailAndPassword } from 'firebase/auth';
import { useState } from 'react';
import { Button, Text, TextInput, View } from 'react-native';
import { auth } from '../firebase';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const loginUser = () => {
    signInWithEmailAndPassword(auth, email, password)
      .then(() => {
        alert('Logged in');
        navigation.navigate('Home');
      })
      .catch(error => alert(error.message));
  };

  return (
    <View style={{ marginTop: 100, padding: 20 }}>
      <Text style={{ fontSize: 24 }}>Login</Text>

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

      <Button title="Login" onPress={loginUser} />
      <Button title="Go to Register" onPress={() => navigation.navigate('Register')} />
    </View>
  );
}