import { useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Text, TouchableOpacity, View } from 'react-native';

import { collection, deleteDoc, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { REQUEST_STATUS, STATUS_LABELS, isAdminEmail } from '../constants/access';
import { auth, db } from '../firebase';

const STATUS_COLORS = {
  [REQUEST_STATUS.OPEN]: '#d97706',
  [REQUEST_STATUS.ACCEPTED]: '#1d4ed8',
  [REQUEST_STATUS.IN_PROGRESS]: '#7c3aed',
  [REQUEST_STATUS.COMPLETED]: '#0f766e',
  [REQUEST_STATUS.PAID]: '#166534',
  [REQUEST_STATUS.CANCELLED]: '#b91c1c',
};

function getEffectiveStatus(item) {
  if (item.status) {
    return item.status;
  }

  if (item.paid) {
    return REQUEST_STATUS.PAID;
  }

  if (item.acceptedBy) {
    return REQUEST_STATUS.ACCEPTED;
  }

  return REQUEST_STATUS.OPEN;
}

export default function Home() {
  const router = useRouter();
  const [requests, setRequests] = useState([]);

  const currentEmail = auth.currentUser?.email || '';
  const isAdmin = useMemo(() => isAdminEmail(currentEmail), [currentEmail]);

  const formatPaidAt = (value) => {
    if (!value) {
      return 'Unavailable';
    }

    const parsedDate = new Date(value);

    if (Number.isNaN(parsedDate.getTime())) {
      return String(value);
    }

    return parsedDate.toLocaleString();
  };

  useEffect(() => {
    return onSnapshot(collection(db, 'requests'), (snapshot) => {
      const data = snapshot.docs
        .map((requestDoc) => ({ id: requestDoc.id, ...requestDoc.data() }))
        .sort((a, b) => {
          const first = a.createdAt?.seconds || 0;
          const second = b.createdAt?.seconds || 0;
          return second - first;
        });

      setRequests(data);
    });
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    router.replace('/auth');
  };

  const handleAccept = async (item) => {
    if (!currentEmail) {
      return;
    }

    await updateDoc(doc(db, 'requests', item.id), {
      acceptedBy: currentEmail,
      status: REQUEST_STATUS.ACCEPTED,
      acceptedAt: new Date().toISOString(),
    });
  };

  const handleStartWork = async (item) => {
    await updateDoc(doc(db, 'requests', item.id), {
      status: REQUEST_STATUS.IN_PROGRESS,
      startedAt: new Date().toISOString(),
    });
  };

  const handleCompleteWork = async (item) => {
    await updateDoc(doc(db, 'requests', item.id), {
      status: REQUEST_STATUS.COMPLETED,
      completedAt: new Date().toISOString(),
    });
  };

  const handleDelete = (item) => {
    Alert.alert(
      'Delete Request',
      'Are you sure you want to delete this request? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteDoc(doc(db, 'requests', item.id));
          },
        },
      ]
    );
  };

  const handlePay = (item) => {
    router.push({
      pathname: '/pay',
      params: {
        id: item.id,
        amount: item.price,
        email: currentEmail,
      },
    });
  };

  const openRateScreen = (item) => {
    router.push({
      pathname: '/rate',
      params: {
        requestId: item.id,
        providerEmail: item.acceptedBy || '',
      },
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f4f6f8', padding: 20 }}>
      <Text style={{ fontSize: 26, fontWeight: 'bold' }}>Welcome</Text>

      <Text style={{ color: 'gray', marginBottom: 15 }}>{currentEmail}</Text>

      <TouchableOpacity
        style={{
          backgroundColor: '#007bff',
          padding: 12,
          borderRadius: 10,
          marginBottom: 10,
        }}
        onPress={() => router.push('/request')}
      >
        <Text style={{ color: 'white', textAlign: 'center', fontWeight: 'bold' }}>+ Create Request</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={{
          backgroundColor: '#111827',
          padding: 10,
          borderRadius: 8,
          marginBottom: 10,
        }}
        onPress={() => router.push('/payments')}
      >
        <Text style={{ color: 'white', textAlign: 'center', fontWeight: '600' }}>Payment Debug</Text>
      </TouchableOpacity>

      {isAdmin ? (
        <TouchableOpacity
          style={{
            backgroundColor: '#7c2d12',
            padding: 10,
            borderRadius: 8,
            marginBottom: 10,
          }}
          onPress={() => router.push('/admin')}
        >
          <Text style={{ color: 'white', textAlign: 'center', fontWeight: '600' }}>Admin Moderation</Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity
        style={{
          backgroundColor: '#dc3545',
          padding: 10,
          borderRadius: 8,
          marginBottom: 15,
        }}
        onPress={handleLogout}
      >
        <Text style={{ color: 'white', textAlign: 'center' }}>Logout</Text>
      </TouchableOpacity>

      <Text style={{ fontSize: 18, marginBottom: 10 }}>Service Requests</Text>

      <FlatList
        data={requests.filter((item) => item.title && item.location && item.price)}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const status = getEffectiveStatus(item);
          const color = STATUS_COLORS[status] || '#d97706';
          const isOwner = item.user === currentEmail;
          const isProvider = item.acceptedBy === currentEmail;

          return (
            <View
              style={{
                backgroundColor: 'white',
                padding: 15,
                borderRadius: 12,
                marginBottom: 15,
                elevation: 3,
              }}
            >
              <Text style={{ fontWeight: 'bold', fontSize: 16 }}>{item.title}</Text>

              <Text style={{ marginTop: 5 }}>Location: {item.location}</Text>

              <Text style={{ marginTop: 5 }}>Amount: GHS {item.price}</Text>

              <Text style={{ marginTop: 5, color }}>Status: {STATUS_LABELS[status] || status}</Text>

              <Text style={{ marginTop: 3, color: '#4b5563' }}>Owner: {item.user || 'Unavailable'}</Text>

              {item.acceptedBy ? (
                <Text style={{ marginTop: 3, color: '#4b5563' }}>Provider: {item.acceptedBy}</Text>
              ) : null}

              {!item.acceptedBy && !isOwner && status === REQUEST_STATUS.OPEN ? (
                <TouchableOpacity
                  style={{
                    backgroundColor: '#007bff',
                    padding: 10,
                    borderRadius: 8,
                    marginTop: 10,
                  }}
                  onPress={() => handleAccept(item)}
                >
                  <Text style={{ color: 'white', textAlign: 'center' }}>Accept</Text>
                </TouchableOpacity>
              ) : null}

              {isProvider && status === REQUEST_STATUS.ACCEPTED ? (
                <TouchableOpacity
                  style={{
                    backgroundColor: '#7c3aed',
                    padding: 10,
                    borderRadius: 8,
                    marginTop: 10,
                  }}
                  onPress={() => handleStartWork(item)}
                >
                  <Text style={{ color: 'white', textAlign: 'center' }}>Start Work</Text>
                </TouchableOpacity>
              ) : null}

              {isProvider && status === REQUEST_STATUS.IN_PROGRESS ? (
                <TouchableOpacity
                  style={{
                    backgroundColor: '#0f766e',
                    padding: 10,
                    borderRadius: 8,
                    marginTop: 10,
                  }}
                  onPress={() => handleCompleteWork(item)}
                >
                  <Text style={{ color: 'white', textAlign: 'center' }}>Mark Completed</Text>
                </TouchableOpacity>
              ) : null}

              {isOwner && status === REQUEST_STATUS.COMPLETED && !item.paid ? (
                <TouchableOpacity
                  style={{
                    backgroundColor: '#16a34a',
                    padding: 10,
                    borderRadius: 8,
                    marginTop: 10,
                  }}
                  onPress={() => handlePay(item)}
                >
                  <Text style={{ color: 'white', textAlign: 'center' }}>Pay Provider</Text>
                </TouchableOpacity>
              ) : null}

              {isOwner && status === REQUEST_STATUS.OPEN ? (
                <TouchableOpacity
                  style={{
                    backgroundColor: '#dc3545',
                    padding: 10,
                    borderRadius: 8,
                    marginTop: 10,
                  }}
                  onPress={() => handleDelete(item)}
                >
                  <Text style={{ color: 'white', textAlign: 'center' }}>Delete Request</Text>
                </TouchableOpacity>
              ) : null}

              {isOwner && status === REQUEST_STATUS.PAID && item.acceptedBy && !item.rating ? (
                <TouchableOpacity
                  style={{
                    backgroundColor: '#f59e0b',
                    padding: 10,
                    borderRadius: 8,
                    marginTop: 10,
                  }}
                  onPress={() => openRateScreen(item)}
                >
                  <Text style={{ color: 'white', textAlign: 'center' }}>Rate Provider</Text>
                </TouchableOpacity>
              ) : null}

              {item.paid ? (
                <View
                  style={{
                    marginTop: 10,
                    padding: 12,
                    borderRadius: 10,
                    backgroundColor: '#ecfdf5',
                  }}
                >
                  <Text style={{ color: '#166534', fontWeight: '700', marginBottom: 6 }}>Payment Completed</Text>

                  <Text style={{ color: '#166534', marginBottom: 4 }}>
                    Status: {item.paymentStatus || 'success'}
                  </Text>

                  <Text style={{ color: '#166534', marginBottom: 4 }}>
                    Reference: {item.paymentReference || 'Unavailable'}
                  </Text>

                  <Text style={{ color: '#166534', marginBottom: 4 }}>
                    Channel: {item.paymentChannel || 'Unavailable'}
                  </Text>

                  <Text style={{ color: '#166534', marginBottom: 4 }}>Paid at: {formatPaidAt(item.paidAt)}</Text>

                  <Text style={{ color: '#166534', marginBottom: 4 }}>
                    Gateway: {item.gatewayResponse || 'Unavailable'}
                  </Text>

                  {item.rating ? (
                    <Text style={{ color: '#166534' }}>
                      Review: {item.rating}/5 {item.review ? `- ${item.review}` : ''}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        }}
      />
    </View>
  );
}
