import { useEffect, useState } from 'react';
import { FlatList, Text } from 'react-native';

import AppCard from '../components/ui/app-card';
import ListScreen from '../components/ui/list-screen.js';
import LoadingSkeleton from '../components/ui/loading-skeleton';
import useAuthUser from '../hooks/use-auth-user';

// Firebase
import { collection, onSnapshot, orderBy, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';

export default function Notifications() {
  const { user, isAuthReady } = useAuthUser();
  const currentEmail = user?.email || '';
  const [notifications, setNotifications] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAuthReady) {
      return undefined;
    }

    if (!currentEmail) {
      setNotifications([]);
      setIsLoading(false);
      return undefined;
    }

    const q = query(
      collection(db, 'notifications'),
      where('user', '==', currentEmail),
      orderBy('createdAt', 'desc'),
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setNotifications(data);
      setIsLoading(false);

      // Mark all unread notifications as read
      snapshot.docs.forEach((docSnap) => {
        if (docSnap.data().read !== true) {
          updateDoc(docSnap.ref, { read: true }).catch(() => {});
        }
      });
    });

    return unsubscribe;
  }, [currentEmail, isAuthReady]);

  return (
    <ListScreen
      eyebrow="UPDATES"
      title="Notifications"
      subtitle="Stay on top of request and payment activity."
      accentColor="#1d4ed8"
      accentTextColor="#dbeafe"
      isLoading={isLoading}
      loadingView={(
        <AppCard>
          <LoadingSkeleton height={18} width="42%" style={{ marginBottom: 12 }} />
          <LoadingSkeleton height={42} width="100%" style={{ marginBottom: 10 }} />
          <LoadingSkeleton height={42} width="100%" style={{ marginBottom: 10 }} />
          <LoadingSkeleton height={42} width="100%" />
        </AppCard>
      )}
      hasItems={notifications.length > 0}
      emptyTitle="No notifications yet"
      emptyDescription="When request updates or payment events arrive, they will appear here."
    >
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <AppCard
              style={{
                marginBottom: 10,
                elevation: 2,
              }}
            >
              <Text style={{ marginBottom: 6, color: '#0f172a', lineHeight: 20 }}>
                {item.text}
              </Text>

              <Text style={{ color: '#64748b', fontSize: 12 }}>
                {item.createdAt
                  ? new Date(
                      item.createdAt.seconds
                        ? item.createdAt.seconds * 1000
                        : item.createdAt,
                    ).toLocaleString()
                  : ''}
              </Text>
            </AppCard>
          )}
        />
    </ListScreen>
  );
}