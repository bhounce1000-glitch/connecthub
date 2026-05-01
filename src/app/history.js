import { useRouter } from 'expo-router';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';
import LoadingSkeleton from '../components/ui/loading-skeleton';

import AppCard from '../components/ui/app-card';
import { AppSpace } from '../constants/design-tokens';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { toDisplayDateTime } from '../utils/date-time';

function statusBadge(status) {
  if (status === 'SUCCESS') return { text: 'SUCCESS', bg: '#dcfce7', color: '#15803d' };
  if (status === 'PENDING') return { text: 'PENDING', bg: '#fef9c3', color: '#b45309' };
  if (status === 'FAILED') return { text: 'FAILED', bg: '#fee2e2', color: '#b91c1c' };
  return { text: status || 'UNKNOWN', bg: '#f3f4f6', color: '#374151' };
}

function TransactionHistoryScreen() {
  const router = useRouter();
  const { user } = useAuthUser();
  const currentEmail = user?.email || '';
  const [transactions, setTransactions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!currentEmail) return;
    setIsLoading(true);
    const q = query(
      collection(db, 'transactions'),
      where('participants', 'array-contains', currentEmail),
      orderBy('timestamp', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      setTransactions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setIsLoading(false);
    });
    return unsub;
  }, [currentEmail]);

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <FlatList
        contentContainerStyle={{ padding: AppSpace.lg }}
        data={transactions}
        keyExtractor={(item) => item.id}
        accessibilityLabel="Transaction history list"
        ListHeaderComponent={
          <View style={{ marginBottom: AppSpace.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 10 }} accessibilityLabel="Go back">
                <Text style={{ fontSize: 22, color: '#4338ca' }}>←</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 25, color: '#1e293b', fontWeight: '800' }}>Transaction History</Text>
            </View>
            <Text style={{ color: '#64748b' }}>All your payments and earnings are shown here for transparency.</Text>
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <>
              <AppCard style={{ marginBottom: 14 }}><LoadingSkeleton height={18} width="60%" style={{ marginBottom: 8 }} /><LoadingSkeleton height={14} width="40%" /></AppCard>
              <AppCard style={{ marginBottom: 14 }}><LoadingSkeleton height={18} width="60%" style={{ marginBottom: 8 }} /><LoadingSkeleton height={14} width="40%" /></AppCard>
            </>
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <Text style={{ fontSize: 40, marginBottom: 8 }} role="img" aria-label="No transactions">📂</Text>
              <Text style={{ color: '#64748b', fontSize: 16, fontWeight: '600', marginBottom: 8 }}>No transactions found</Text>
              <Text style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center', maxWidth: 320 }}>
                When you send or receive payments, your full transaction history will appear here. If you think something is missing, try refreshing or contact support.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const isSender = item.senderEmail === currentEmail;
          const isReceiver = item.receiverEmail === currentEmail;
          const badge = statusBadge(item.status);
          const otherName = isSender ? (item.receiverName || item.receiverEmail) : (item.senderName || item.senderEmail);
          const amount = Number(item.amount || 0);
          const commission = Number(item.commission || 0);
          const net = Number(item.netAmount || 0);
          return (
            <AppCard style={{ marginBottom: 12 }} accessibilityLabel={`Transaction for ${item.jobTitle || 'Job'} with ${otherName}`}> 
              <Text style={{ fontWeight: '800', fontSize: 16, color: '#1e293b', marginBottom: 3 }} numberOfLines={1}>{item.jobTitle || 'Job'}</Text>
              <Text style={{ color: '#334155', marginBottom: 2, fontSize: 13 }}>With: {otherName}</Text>
              <Text style={{ color: '#64748b', fontSize: 12 }}>Date: {toDisplayDateTime(item.timestamp)}</Text>
              <Text style={{ color: '#1e293b', fontWeight: '700', marginTop: 6 }}>Amount: GHS {amount.toFixed(2)}</Text>
              <Text style={{ color: '#b91c1c', fontSize: 12, marginTop: 2 }}>Commission: GHS {commission.toFixed(2)}</Text>
              <Text style={{ color: '#15803d', fontSize: 12, marginTop: 2 }}>You received: GHS {isReceiver ? net.toFixed(2) : (amount - commission).toFixed(2)}</Text>
              <Text style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>Payment method: {item.paymentMethod || 'N/A'}</Text>
              <View style={{ marginTop: 8, alignSelf: 'flex-start', backgroundColor: badge.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ color: badge.color, fontWeight: '700', fontSize: 12 }}>{badge.text}</Text>
              </View>
              <Text style={{ color: '#64748b', fontSize: 11, marginTop: 8 }}>Transaction ID: {item.transactionId}</Text>
            </AppCard>
          );
        }}
      />
    </View>
  );
}

export default TransactionHistoryScreen;
