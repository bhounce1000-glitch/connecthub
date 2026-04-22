import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Text, TextInput, TouchableOpacity, View } from 'react-native';

// Firebase
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';

export default function Auth() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true); // switch mode

  // LOGIN
  const handleLogin = async () => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.replace('/home');
    } catch (error) {
      Alert.alert("Login Error", error.message);
    }
  };

  // SIGN UP
  const handleSignup = async () => {
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      Alert.alert("Success", "Account created successfully 🎉");
      router.replace('/home');
    } catch (error) {
      Alert.alert("Signup Error", error.message);
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 20 }}>

      <Text style={{ fontSize: 26, marginBottom: 20, textAlign: 'center' }}>
        {isLogin ? "Login" : "Create Account"}
      </Text>

      <TextInput
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        style={{
          borderWidth: 1,
          padding: 10,
          marginBottom: 10,
          borderRadius: 6
        }}
      />

      <TextInput
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={{
          borderWidth: 1,
          padding: 10,
          marginBottom: 15,
          borderRadius: 6
        }}
      />

      {/* MAIN BUTTON */}
      <TouchableOpacity
        style={{
          backgroundColor: '#007bff',
          padding: 12,
          borderRadius: 8
        }}
        onPress={isLogin ? handleLogin : handleSignup}
      >
        <Text style={{ color: 'white', textAlign: 'center' }}>
          {isLogin ? "Login" : "Sign Up"}
        </Text>
      </TouchableOpacity>

      {/* SWITCH BUTTON */}
      <TouchableOpacity
        style={{ marginTop: 15 }}
        onPress={() => setIsLogin(!isLogin)}
      >
        <Text style={{ textAlign: 'center', color: 'blue' }}>
          {isLogin
            ? "Don't have an account? Sign Up"
            : "Already have an account? Login"}
        </Text>
      </TouchableOpacity>

    </View>
  );
}