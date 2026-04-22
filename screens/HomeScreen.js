import React from 'react';
import { View, Text, Button } from 'react-native';

export default function HomeScreen() {
  return (
    <View style={{ marginTop: 100, padding: 20 }}>
      <Text style={{ fontSize: 24 }}>Home</Text>

      <Button title="Request Plumber" onPress={() => alert('Plumber Requested')} />
      <Button title="Request Electrician" onPress={() => alert('Electrician Requested')} />
    </View>
  );
}