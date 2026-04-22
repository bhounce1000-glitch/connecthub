import React, { useState } from 'react';
import { View, Text, TextInput, Button } from 'react-native';
import { auth } from '../firebase';
import { createUserWithEmailAndPassword } from 'firebase/auth';

export default function RegisterScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const registerUser = () => {
    createUserWithEmailAndPassword(auth, email, password)
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