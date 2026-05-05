import { useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
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

  const stats = useMemo(() => {
    let earned = 0;
    let pending = 0;
    let withdrawn = 0;
    transactions.forEach((row) => {
      const amount = Number(row.amount || 0);
      const status = String(row.status || '').toLowerCase();
      if (row.direction === 'received') {
        if (status === 'pending') {
          pending += amount;
        } else {
          earned += amount;
        }
      }
      if (row.direction === 'sent') {
        withdrawn += amount;
      }
    });
    return { earned, pending, withdrawn };
  }, [transactions]);

  const groupedTransactions = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - 7);

    const groups = { Today: [], Yesterday: [], 'This Week': [], Earlier: [] };
    transactions.forEach((item) => {
      const raw = item?.timestamp?.seconds ? item.timestamp.seconds * 1000 : new Date(item.timestamp || 0).getTime();
      const time = Number.isFinite(raw) ? raw : 0;
      if (time >= startOfToday.getTime()) groups.Today.push(item);
      else if (time >= startOfYesterday.getTime()) groups.Yesterday.push(item);
      else if (time >= startOfWeek.getTime()) groups['This Week'].push(item);
      else groups.Earlier.push(item);
    });

    return Object.entries(groups).filter(([, rows]) => rows.length > 0);
  }, [transactions]);

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
        data={groupedTransactions}
        keyExtractor={(item) => item[0]}
        ListHeaderComponent={
          <View>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: AppSpace.md }}>
              <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 12 }}>
                <Text style={{ fontSize: 22, color: '#4f46e5' }}>←</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 24, fontWeight: '800', color: AppColors.ink900 }}>💰 Wallet</Text>
            </View>

            <View style={{ backgroundColor: '#1d4ed8', borderRadius: AppRadius.lg, padding: 18, marginBottom: AppSpace.md }}>
              <Text style={{ color: '#bfdbfe', fontWeight: '700', fontSize: 12 }}>ConnectHub Wallet</Text>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 34, marginTop: 4 }}>GHS {Number(walletBalance || 0).toFixed(2)}</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <TouchableOpacity disabled style={{ flex: 1, borderWidth: 1, borderColor: '#dbeafe', borderRadius: AppRadius.md, paddingVertical: 10, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '800' }}>Withdraw</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ flex: 1, borderRadius: AppRadius.md, paddingVertical: 10, alignItems: 'center', backgroundColor: '#2563eb' }}>
                  <Text style={{ color: '#fff', fontWeight: '800' }}>Transaction History</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 8, marginBottom: AppSpace.md }}>
              <StatCard label="Total Earned" value={`GHS ${stats.earned.toFixed(2)}`} color="#166534" bg="#ecfdf5" />
              <StatCard label="Pending" value={`GHS ${stats.pending.toFixed(2)}`} color="#b45309" bg="#fffbeb" />
              <StatCard label="Total Withdrawn" value={`GHS ${stats.withdrawn.toFixed(2)}`} color="#b91c1c" bg="#fef2f2" />
            </View>

            {errorMessage ? (
              <View style={{ backgroundColor: '#fee2e2', borderRadius: AppRadius.md, padding: 12, marginBottom: AppSpace.md }}>
                <Text style={{ color: '#991b1b', fontSize: 13 }}>{errorMessage}</Text>
              </View>
            ) : null}

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
              <Text style={{ fontSize: 40, marginBottom: 12 }}>👛</Text>
              <Text style={{ fontSize: 16, color: AppColors.ink500, fontWeight: '700', textAlign: 'center' }}>Your wallet is empty</Text>
              <Text style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', marginTop: 4 }}>
                Complete jobs to earn money.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const [groupLabel, rows] = item;
          return (
            <View style={{ marginBottom: 16 }}>
              <Text style={{ color: '#334155', fontWeight: '800', marginBottom: 8 }}>{groupLabel}</Text>
              {rows.map((row) => {
                const isReceived = row.direction === 'received';
                const icon = isReceived ? '↑' : (String(row.paymentMethod || '').includes('withdraw') ? '↗' : '↓');
                const iconBg = isReceived ? '#dcfce7' : '#fee2e2';
                const iconColor = isReceived ? '#166534' : '#b91c1c';
                return (
                  <AppCard key={row.id} style={{ marginBottom: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                        <Text style={{ color: iconColor, fontWeight: '900' }}>{icon}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: AppColors.ink900, fontWeight: '800' }}>{row.jobTitle || 'Transaction'}</Text>
                        <Text style={{ color: AppColors.ink500, fontSize: 12 }} numberOfLines={1}>{row.transactionId || row.id}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: isReceived ? '#166534' : '#b91c1c', fontWeight: '800' }}>{isReceived ? '+' : '-'} GHS {Number(row.amount || 0).toFixed(2)}</Text>
                        <Text style={{ color: '#64748b', fontSize: 11 }}>{toDisplayDateTime(row.timestamp)}</Text>
                      </View>
                    </View>
                  </AppCard>
                );
              })}
            </View>
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
