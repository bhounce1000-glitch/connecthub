import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Button, FlatList, Text, View } from 'react-native';

// Firebase
import { collection, deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import { REQUEST_STATUS, STATUS_LABELS } from '../constants/access';
import { auth, db } from '../firebase';

export default function MyRequests() {
  const router = useRouter();
  const [myRequests, setMyRequests] = useState([]);

  // 🔥 REAL-TIME MY REQUESTS ONLY
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "requests"), (snapshot) => {
      const data = snapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
        .filter(item => item.user === auth.currentUser?.email); // ✅ ONLY YOURS

      setMyRequests(data);
    });

    return unsubscribe;
  }, []);

  // 🗑 DELETE
  const handleDelete = async (item) => {
    try {
      const status = item.status || REQUEST_STATUS.OPEN;

      if (status !== REQUEST_STATUS.OPEN || item.paid) {
        alert('Only open and unpaid requests can be deleted.');
        return;
      }

      await deleteDoc(doc(db, "requests", item.id));
      alert("Deleted 🗑");
    } catch (error) {
      alert(error.message);
    }
  };

  return (
    <View style={{ padding: 20 }}>

      <Text style={{ fontSize: 22, marginBottom: 10 }}>
        📂 My Requests
      </Text>

      <Button title="Back to Home" onPress={() => router.replace('/home')} />

      <View style={{ height: 20 }} />

      <FlatList
        data={myRequests.filter(item => item.location && item.price)}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View
            style={{
              marginBottom: 15,
              padding: 12,
              borderWidth: 1,
              borderRadius: 10
            }}
          >
            <Text style={{ fontWeight: 'bold' }}>
              📝 {item.title}
            </Text>

            <Text>📍 {item.location}</Text>
            <Text>💰 ${item.price}</Text>
            <Text>📌 {STATUS_LABELS[item.status] || item.status || 'Open'}</Text>

            {item.acceptedBy ? (
              <Text style={{ color: 'green' }}>
                ✅ Accepted by: {item.acceptedBy}
              </Text>
            ) : (
              <Text>⏳ Not accepted yet</Text>
            )}

            <View style={{ marginTop: 10 }}>
              <Button
                title="Delete"
                color="red"
                onPress={() => handleDelete(item)}
              />
            </View>

          </View>
        )}
      />

    </View>
  );
}