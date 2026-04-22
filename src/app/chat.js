import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';

// Firebase
import { addDoc, collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { auth, db } from '../firebase';

export default function Chat() {
  const { requestId } = useLocalSearchParams();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');

  useEffect(() => {
    if (!requestId) {
      return undefined;
    }

    const q = query(
      collection(db, "chats", requestId, "messages"),
      orderBy("createdAt", "asc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => doc.data());
      setMessages(data);
    });

    return unsubscribe;
  }, [requestId]);

  const sendMessage = async () => {
    if (!text) return;

    await addDoc(collection(db, "chats", requestId, "messages"), {
      text,
      user: auth.currentUser?.email,
      createdAt: new Date()
    });

    setText('');
  };

  return (
    <View style={{ flex: 1, padding: 10, backgroundColor: '#f5f5f5' }}>

      <FlatList
        data={messages}
        keyExtractor={(_, i) => i.toString()}
        renderItem={({ item }) => {
          const isMe = item.user === auth.currentUser?.email;

          return (
            <View
              style={{
                alignSelf: isMe ? 'flex-end' : 'flex-start',
                backgroundColor: isMe ? '#007bff' : '#e5e5ea',
                padding: 10,
                borderRadius: 10,
                marginVertical: 5,
                maxWidth: '75%'
              }}
            >
              <Text style={{ color: isMe ? 'white' : 'black' }}>
                {item.text}
              </Text>
            </View>
          );
        }}
      />

      {/* INPUT */}
      <View style={{ flexDirection: 'row', marginTop: 10 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Type a message..."
          style={{
            flex: 1,
            borderWidth: 1,
            borderRadius: 20,
            padding: 10,
            backgroundColor: 'white'
          }}
        />

        <TouchableOpacity
          onPress={sendMessage}
          style={{
            backgroundColor: '#007bff',
            padding: 12,
            borderRadius: 20,
            marginLeft: 5
          }}
        >
          <Text style={{ color: 'white' }}>Send</Text>
        </TouchableOpacity>
      </View>

    </View>
  );
}