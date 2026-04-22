import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Button, Text, TextInput, View } from 'react-native';

// Firebase
import { addDoc, collection } from 'firebase/firestore';
import { REQUEST_STATUS } from '../constants/access';
import { auth, db } from '../firebase';

export default function Request() {
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [price, setPrice] = useState('');
  const [image, setImage] = useState('');

  return (
    <View style={{ padding: 20 }}>

      <Text style={{ fontSize: 20, marginBottom: 10 }}>
        Create Request
      </Text>

      <TextInput
        placeholder="Title"
        value={title}
        onChangeText={setTitle}
        style={{ borderWidth: 1, padding: 10, marginBottom: 10 }}
      />

      <TextInput
        placeholder="Location"
        value={location}
        onChangeText={setLocation}
        style={{ borderWidth: 1, padding: 10, marginBottom: 10 }}
      />

      <TextInput
        placeholder="Price"
        value={price}
        onChangeText={setPrice}
        style={{ borderWidth: 1, padding: 10, marginBottom: 10 }}
      />

      {/* SIMPLE IMAGE INPUT (URL for now) */}
      <TextInput
        placeholder="Paste Image URL (optional)"
        value={image}
        onChangeText={setImage}
        style={{ borderWidth: 1, padding: 10, marginBottom: 20 }}
      />

      <Button
        title="Submit Request"
        onPress={async () => {
          if (!title.trim() || !location.trim() || !price.trim()) {
            alert('Please fill title, location, and price.');
            return;
          }

          await addDoc(collection(db, "requests"), {
            title: title.trim(),
            location: location.trim(),
            price: price.trim(),
            image: image.trim(),
            user: auth.currentUser?.email,
            acceptedBy: null,
            status: REQUEST_STATUS.OPEN,
            paid: false,
            rating: null,
            review: '',
            createdAt: new Date(),
          });

          alert("Request saved 🚀");
          router.replace('/home');
        }}
      />

    </View>
  );
}