import { collection, onSnapshot } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { REQUEST_STATUS, STATUS_LABELS, isAdminEmail } from '../constants/access';
import { API_BASE_URL } from '../constants/api';
import { auth, db } from '../firebase';

export default function Admin() {
  const [requests, setRequests] = useState([]);
  const currentEmail = auth.currentUser?.email || '';
  const isAdmin = useMemo(() => isAdminEmail(currentEmail), [currentEmail]);

  useEffect(() => {
    if (!isAdmin) {
      return undefined;
    }

    return onSnapshot(collection(db, 'requests'), (snapshot) => {
      const rows = snapshot.docs
        .map((requestDoc) => ({ id: requestDoc.id, ...requestDoc.data() }))
        .sort((a, b) => {
          const first = a.createdAt?.seconds || 0;
          const second = b.createdAt?.seconds || 0;
          return second - first;
        });

      setRequests(rows);
    });
  }, [isAdmin]);

  const getAuthHeaders = async () => {
    const token = await auth.currentUser?.getIdToken(true);

    if (!token) {
      throw new Error('You are not authenticated');
    }

    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  };

  const setStatus = async (item, nextStatus) => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/admin/requests/${item.id}/moderate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          status: nextStatus,
          note: 'Updated from admin screen',
        }),
      });

      const result = await response.json();

      if (!response.ok || !result?.status) {
        throw new Error(result?.error || result?.message || 'Moderation request failed');
      }
    } catch (error) {
      Alert.alert('Moderation failed', error.message || 'Could not update this request status.');
    }
  };

  const deleteRequest = (item) => {
    Alert.alert('Delete request', 'Delete this request permanently?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const headers = await getAuthHeaders();
            const response = await fetch(`${API_BASE_URL}/admin/requests/${item.id}`, {
              method: 'DELETE',
              headers,
            });

            const result = await response.json();

            if (!response.ok || !result?.status) {
              throw new Error(result?.error || result?.message || 'Delete request failed');
            }
          } catch (error) {
            Alert.alert('Delete failed', error.message || 'Could not delete this request.');
          }
        },
      },
    ]);
  };

  if (!isAdmin) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 8 }}>Restricted</Text>
        <Text style={{ color: '#4b5563', textAlign: 'center' }}>
          This area is only available to admin accounts.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f4f6f8' }} contentContainerStyle={{ padding: 20 }}>
      <Text style={{ fontSize: 28, fontWeight: '700', marginBottom: 8 }}>Admin Moderation</Text>
      <Text style={{ color: '#4b5563', marginBottom: 18 }}>Manage status and moderate request records.</Text>

      {requests.map((item) => (
        <View key={item.id} style={{ backgroundColor: 'white', borderRadius: 14, padding: 14, marginBottom: 12 }}>
          <Text style={{ fontWeight: '700', marginBottom: 4 }}>{item.title || item.id}</Text>
          <Text>ID: {item.id}</Text>
          <Text>User: {item.user || 'Unavailable'}</Text>
          <Text>Provider: {item.acceptedBy || 'Unassigned'}</Text>
          <Text>Status: {STATUS_LABELS[item.status] || item.status || 'Open'}</Text>
          <Text>Paid: {item.paid ? 'Yes' : 'No'}</Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
            <TouchableOpacity
              style={{ backgroundColor: '#1d4ed8', padding: 8, borderRadius: 8, marginRight: 8, marginBottom: 8 }}
              onPress={() => setStatus(item, REQUEST_STATUS.OPEN)}
            >
              <Text style={{ color: 'white' }}>Reopen</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ backgroundColor: '#0f766e', padding: 8, borderRadius: 8, marginRight: 8, marginBottom: 8 }}
              onPress={() => setStatus(item, REQUEST_STATUS.COMPLETED)}
            >
              <Text style={{ color: 'white' }}>Complete</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ backgroundColor: '#16a34a', padding: 8, borderRadius: 8, marginRight: 8, marginBottom: 8 }}
              onPress={() => setStatus(item, REQUEST_STATUS.PAID)}
            >
              <Text style={{ color: 'white' }}>Mark Paid</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ backgroundColor: '#b91c1c', padding: 8, borderRadius: 8, marginRight: 8, marginBottom: 8 }}
              onPress={() => setStatus(item, REQUEST_STATUS.CANCELLED)}
            >
              <Text style={{ color: 'white' }}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ backgroundColor: '#7f1d1d', padding: 8, borderRadius: 8, marginBottom: 8 }}
              onPress={() => deleteRequest(item)}
            >
              <Text style={{ color: 'white' }}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {!requests.length ? (
        <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 12 }}>
          <Text style={{ color: '#4b5563' }}>No requests found.</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
