import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, Text, TouchableOpacity, View } from 'react-native';

import AppCard from '../components/ui/app-card';
import LoadingSkeleton from '../components/ui/loading-skeleton';
import { AppColors, AppRadius, AppShadow, AppSpace } from '../constants/design-tokens';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { toDisplayDateTime } from '../utils/date-time';

function toMs(value) {
  if (!value) return 0;
  if (value?.seconds) return value.seconds * 1000;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function groupLabel(ts) {
  const date = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 6);

  if (date >= today) return 'Today';
  if (date >= yesterday) return 'Yesterday';
  if (date >= weekStart) return date.toLocaleDateString(undefined, { weekday: 'long' });
  return 'Earlier';
}

export default function Wallet() {
  const router = useRouter();
  const { user } = useAuthUser();
  const currentEmail = (user?.email || '').trim().toLowerCase();

  const [transactions, setTransactions] = useState([]);
  const [walletBalance, setWalletBalance] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const loadWallet = async () => {
    if (!currentEmail) {
      setTransactions([]);
      setWalletBalance(0);
      setIsLoading(false);
      return;
    }

    setErrorMessage('');
    try {
      const userSnap = await getDoc(doc(db, 'users', currentEmail));
      const balance = userSnap.exists() ? Number(userSnap.data()?.walletBalance || 0) : 0;

      const sentQ = query(collection(db, 'transactions'), where('senderEmail', '==', currentEmail), orderBy('timestamp', 'desc'));
      const receivedQ = query(collection(db, 'transactions'), where('receiverEmail', '==', currentEmail), orderBy('timestamp', 'desc'));
      const [sentSnap, receivedSnap] = await Promise.all([getDocs(sentQ), getDocs(receivedQ)]);

      const sentRows = sentSnap.docs.map((d) => ({ id: d.id, ...d.data(), direction: 'sent' }));
      const receivedRows = receivedSnap.docs.map((d) => ({ id: d.id, ...d.data(), direction: 'received' }));

      const byId = new Map();
      [...sentRows, ...receivedRows].forEach((row) => byId.set(row.id, row));
      const merged = Array.from(byId.values()).sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp));

      setWalletBalance(Number.isFinite(balance) ? balance : 0);
      setTransactions(merged);
    } catch (error) {
      setErrorMessage(error?.message || 'Could not load wallet data.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    setIsLoading(true);
    loadWallet();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEmail]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadWallet();
  };

  const stats = useMemo(() => {
    let earned = 0;
    let pending = 0;
    let withdrawn = 0;

    transactions.forEach((row) => {
      const amount = Number(row.amount || 0);
      const status = String(row.status || '').toLowerCase();
      const method = String(row.paymentMethod || '').toLowerCase();
      if (row.direction === 'received') {
        if (status === 'pending') pending += amount;
        else earned += amount;
      }
      if (row.direction === 'sent' || method.includes('withdraw')) {
        withdrawn += amount;
      }
    });

    return { earned, pending, withdrawn };
  }, [transactions]);

  const grouped = useMemo(() => {
    const map = new Map();
    transactions.forEach((row) => {
      const label = groupLabel(toMs(row.timestamp));
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(row);
    });
    return Array.from(map.entries());
  }, [transactions]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f8fafc', padding: AppSpace.lg }}>
        {[1, 2, 3].map((n) => (
          <AppCard key={n} style={{ marginBottom: 12 }}>
            <LoadingSkeleton height={18} width="50%" style={{ marginBottom: 8 }} />
            <LoadingSkeleton height={14} width="70%" />
          </AppCard>
        ))}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <FlatList
        data={grouped}
        keyExtractor={(item) => item[0]}
        contentContainerStyle={{ padding: AppSpace.lg, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
        ListHeaderComponent={(
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 10 }}>
                <Text style={{ fontSize: 22, color: '#1d4ed8' }}>←</Text>
              </TouchableOpacity>
              <Text style={{ fontWeight: '900', fontSize: 24, color: AppColors.ink900 }}>Wallet</Text>
            </View>

            <View style={{ backgroundColor: '#1e3a8a', borderRadius: AppRadius.lg, padding: 18, marginBottom: 12, ...AppShadow.card }}>
              <Text style={{ color: '#cbd5e1', fontSize: 12, fontWeight: '700' }}>ConnectHub Wallet</Text>
              <Text style={{ color: '#fff', fontSize: 36, fontWeight: '900', marginTop: 4 }}>GHS {Number(walletBalance || 0).toFixed(2)}</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <TouchableOpacity style={{ flex: 1, borderWidth: 1, borderColor: '#fff', borderRadius: AppRadius.md, paddingVertical: 10, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '800' }}>Withdraw</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ flex: 1, borderRadius: AppRadius.md, paddingVertical: 10, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.14)' }}>
                  <Text style={{ color: '#fff', fontWeight: '800' }}>Add Money</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              <QuickStat label="Total Earned" value={`GHS ${stats.earned.toFixed(2)}`} />
              <QuickStat label="Pending" value={`GHS ${stats.pending.toFixed(2)}`} />
              <QuickStat label="Withdrawn" value={`GHS ${stats.withdrawn.toFixed(2)}`} />
            </View>

            {errorMessage ? (
              <View style={{ backgroundColor: '#fee2e2', borderRadius: AppRadius.md, padding: 10, marginBottom: 10 }}>
                <Text style={{ color: '#991b1b', fontSize: 12 }}>{errorMessage}</Text>
              </View>
            ) : null}

            <Text style={{ marginBottom: 10, color: AppColors.ink900, fontWeight: '900', fontSize: 16 }}>
              Transaction History ({transactions.length})
            </Text>
          </>
        )}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingVertical: 48 }}>
            <Text style={{ fontSize: 64 }}>👛</Text>
            <Text style={{ marginTop: 10, fontWeight: '800', color: AppColors.ink900, fontSize: 18 }}>Your wallet is empty</Text>
            <Text style={{ color: '#64748b', marginTop: 6 }}>Complete jobs to earn GHS</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const [label, rows] = item;
          return (
            <View style={{ marginBottom: 14 }}>
              {index > 0 ? <View style={{ height: 1, backgroundColor: '#e2e8f0', marginBottom: 10 }} /> : null}
              <Text style={{ fontWeight: '800', color: '#475569', marginBottom: 8 }}>{label}</Text>
              {rows.map((row) => {
                const method = String(row.paymentMethod || '').toLowerCase();
                const isWithdrawal = method.includes('withdraw');
                const isReceived = row.direction === 'received' && !isWithdrawal;
                const icon = isReceived ? '↑' : isWithdrawal ? '→' : '↓';
                const iconBg = isReceived ? '#dcfce7' : isWithdrawal ? '#ffedd5' : '#fee2e2';
                const iconColor = isReceived ? '#166534' : isWithdrawal ? '#c2410c' : '#b91c1c';
                const amountColor = isReceived ? '#166534' : '#b91c1c';

                return (
                  <View key={row.id} style={{ backgroundColor: '#fff', borderRadius: AppRadius.md, borderWidth: 1, borderColor: '#e2e8f0', padding: 12, marginBottom: 8, ...AppShadow.card }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                        <Text style={{ color: iconColor, fontWeight: '900' }}>{icon}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: AppColors.ink900, fontWeight: '800' }}>{row.jobTitle || row.type || 'Transaction'}</Text>
                        <Text style={{ color: '#94a3b8', fontSize: 12 }} numberOfLines={1}>{row.transactionId || row.reference || row.id}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: amountColor, fontWeight: '800' }}>{isReceived ? '+' : '-'} GHS {Number(row.amount || 0).toFixed(2)}</Text>
                        <Text style={{ color: '#94a3b8', fontSize: 11 }}>{toDisplayDateTime(row.timestamp)}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          );
        }}
      />
    </View>
  );
}

function QuickStat({ label, value }) {
  return (
    <View style={{ flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: AppRadius.md, paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center' }}>
      <Text style={{ color: '#94a3b8', fontSize: 11 }}>{label}</Text>
      <Text style={{ color: AppColors.ink900, fontWeight: '800', marginTop: 4, fontSize: 13 }} numberOfLines={1}>{value}</Text>
    </View>
  );
}
