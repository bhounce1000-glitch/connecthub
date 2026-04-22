import { useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';

// Firebase
import { collection, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';

export default function Notifications() {
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "notifications"), (snapshot) => {
      const data = snapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
        .filter(item => item.user === auth.currentUser?.email)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // newest first

      setNotifications(data);
    });

    return unsubscribe;
  }, []);

  return (
    <View style={{ flex: 1, padding: 20, backgroundColor: '#f5f5f5' }}>

      <Text style={{ fontSize: 22, marginBottom: 15 }}>
        🔔 Notifications
      </Text>

      {/* EMPTY STATE */}
      {notifications.length === 0 && (
        <Text style={{ color: 'gray' }}>
          No notifications yet...
        </Text>
      )}

      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View
            style={{
              backgroundColor: 'white',
              padding: 15,
              borderRadius: 10,
              marginBottom: 10,
              elevation: 2
            }}
          >
            <Text style={{ marginBottom: 5 }}>
              {item.text}
            </Text>

            {/* TIME */}
            <Text style={{ color: 'gray', fontSize: 12 }}>
              {item.createdAt
                ? new Date(item.createdAt.seconds * 1000).toLocaleString()
                : ''}
            </Text>
          </View>
        )}
      />

    </View>
  );
}