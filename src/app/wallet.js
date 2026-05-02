import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';

import AppCard from '../components/ui/app-card';
import LoadingSkeleton from '../components/ui/loading-skeleton';
import { AppColors, AppRadius, AppSpace } from '../constants/design-tokens';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { toDisplayDateTime } from '../utils/date-time';

export default function Wallet() {
  const router = useRouter();
  const { user } = useAuthUser();

  const [transactions, setTransactions] = useState([]);
  const [walletBalance, setWalletBalance] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const currentEmail = user?.email || '';

  useEffect(() => {
    if (!currentEmail) {
      setTransactions([]);
      setWalletBalance(0);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const loadWallet = async () => {
      setIsLoading(true);
      setErrorMessage('');

      try {
        const userEmail = String(currentEmail).trim().toLowerCase();

        // 1) user wallet balance
        const userSnap = await getDoc(doc(db, 'users', userEmail));
        const nextBalance = userSnap.exists() ? Number(userSnap.data()?.walletBalance || 0) : 0;

        // 2) sent transactions
        const q = query(
          collection(db, 'transactions'),
          where('senderEmail', '==', userEmail),
          orderBy('timestamp', 'desc')
        );

        // 3) received transactions
        const q2 = query(
          collection(db, 'transactions'),
          where('receiverEmail', '==', userEmail),
          orderBy('timestamp', 'desc')
        );

        const [sentSnap, receivedSnap] = await Promise.all([getDocs(q), getDocs(q2)]);

        const sentRows = sentSnap.docs.map((d) => ({ id: d.id, ...d.data(), direction: 'sent' }));
        const receivedRows = receivedSnap.docs.map((d) => ({ id: d.id, ...d.data(), direction: 'received' }));

        const mergedMap = new Map();
        [...sentRows, ...receivedRows].forEach((row) => {
          mergedMap.set(row.id, row);
        });

        const merged = [...mergedMap.values()].sort((a, b) => {
          const left = a?.timestamp?.seconds ? a.timestamp.seconds * 1000 : new Date(a.timestamp || 0).getTime();
          const right = b?.timestamp?.seconds ? b.timestamp.seconds * 1000 : new Date(b.timestamp || 0).getTime();
          return right - left;
        });

        if (!cancelled) {
          setWalletBalance(Number.isFinite(nextBalance) ? nextBalance : 0);
          setTransactions(merged);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error?.message || 'Could not load wallet data.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadWallet();
    return () => {
      cancelled = true;
    };
  }, [currentEmail]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f8fafc', padding: AppSpace.lg }}>
        <LoadingSkeleton height={22} width="50%" style={{ marginBottom: 16 }} />
        {[1, 2, 3].map((n) => (
          <AppCard key={n} style={{ marginBottom: 14 }}>
            <LoadingSkeleton height={18} width="60%" style={{ marginBottom: 8 }} />
            <LoadingSkeleton height={14} width="40%" />
          </AppCard>
        ))}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <FlatList
        contentContainerStyle={{ padding: AppSpace.lg }}
        data={transactions}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: AppSpace.md }}>
              <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 12 }}>
                <Text style={{ fontSize: 22, color: '#4f46e5' }}>←</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 24, fontWeight: '800', color: AppColors.ink900 }}>💰 Wallet</Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: AppSpace.md }}>
              <StatCard label="Wallet Balance" value={`GHS ${Number(walletBalance || 0).toFixed(2)}`} color="#059669" bg="#ecfdf5" />
            </View>

            {errorMessage ? (
              <View style={{ backgroundColor: '#fee2e2', borderRadius: AppRadius.md, padding: 12, marginBottom: AppSpace.md }}>
                <Text style={{ color: '#991b1b', fontSize: 13 }}>{errorMessage}</Text>
              </View>
            ) : null}

            {/* Withdraw placeholder */}
            <TouchableOpacity
              disabled
              style={{ backgroundColor: '#e0e7ff', borderRadius: AppRadius.md, paddingVertical: 14, alignItems: 'center', marginBottom: AppSpace.md }}
            >
              <Text style={{ color: '#4f46e5', fontWeight: '800', fontSize: 15 }}>🏦 Withdraw to Bank</Text>
              <Text style={{ color: '#6366f1', fontSize: 12, marginTop: 2 }}>Bank payout coming soon</Text>
            </TouchableOpacity>

            <Text style={{ fontWeight: '800', fontSize: 16, color: AppColors.ink900, marginBottom: 10 }}>Transaction History</Text>
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
              <Text style={{ fontSize: 40, marginBottom: 12 }}>📭</Text>
              <Text style={{ fontSize: 16, color: AppColors.ink500, fontWeight: '700', textAlign: 'center' }}>No transactions yet</Text>
              <Text style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', marginTop: 4 }}>
                Transactions you send or receive will appear here.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const badge = item.status === 'SUCCESS' ? { text: 'SUCCESS', bg: '#dcfce7', color: '#15803d' }
            : item.status === 'PENDING' ? { text: 'PENDING', bg: '#fef9c3', color: '#b45309' }
            : item.status === 'FAILED' ? { text: 'FAILED', bg: '#fee2e2', color: '#b91c1c' }
            : { text: item.status || 'UNKNOWN', bg: '#f3f4f6', color: '#374151' };
          return (
            <AppCard style={{ marginBottom: 12 }}>
              <Text style={{ fontWeight: '800', fontSize: 16, color: AppColors.ink900, marginBottom: 3 }} numberOfLines={1}>{item.jobTitle || 'Job'}</Text>
              <Text style={{ color: AppColors.ink700, marginBottom: 2, fontSize: 13 }}>
                {item.direction === 'sent' ? 'To' : 'From'}: {item.direction === 'sent' ? (item.receiverName || item.receiverEmail) : (item.senderName || item.senderEmail)}
              </Text>
              <Text style={{ color: AppColors.ink500, fontSize: 12 }}>Date: {toDisplayDateTime(item.timestamp)}</Text>
              <Text style={{ color: AppColors.ink900, fontWeight: '700', marginTop: 6 }}>Amount: GHS {Number(item.amount || 0).toFixed(2)}</Text>
              <Text style={{ color: item.direction === 'sent' ? '#7c2d12' : '#166534', fontSize: 12, marginTop: 2 }}>
                Type: {item.direction === 'sent' ? 'Sent Payment' : 'Received Payment'}
              </Text>
              {item.netAmount != null ? (
                <Text style={{ color: '#15803d', fontSize: 12, marginTop: 2 }}>Net Amount: GHS {Number(item.netAmount || 0).toFixed(2)}</Text>
              ) : null}
              <Text style={{ color: AppColors.ink500, fontSize: 12, marginTop: 2 }}>Payment method: {item.paymentMethod || 'N/A'}</Text>
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

function StatCard({ label, value, color, bg }) {
  return (
    <View style={{ flex: 1, backgroundColor: bg, borderRadius: AppRadius.md, padding: 14, alignItems: 'center' }}>
      <Text style={{ fontSize: 17, fontWeight: '800', color }}>{value}</Text>
      <Text style={{ fontSize: 11, color, marginTop: 3, fontWeight: '600', textAlign: 'center' }}>{label}</Text>
    </View>
  );
}
