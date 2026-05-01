import { useRouter } from 'expo-router';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
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

  const [received, setReceived] = useState([]);
  const [sent, setSent] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const currentEmail = user?.email || '';

  useEffect(() => {
    if (!currentEmail) return;
    setIsLoading(true);
    let receivedLoaded = false;
    let sentLoaded = false;
    const checkDone = () => { if (receivedLoaded && sentLoaded) setIsLoading(false); };

    const q1 = query(collection(db, 'transactions'), where('receiverEmail', '==', currentEmail), orderBy('timestamp', 'desc'));
    const unsub1 = onSnapshot(q1, (snap) => {
      setReceived(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      receivedLoaded = true;
      checkDone();
    });

    const q2 = query(collection(db, 'transactions'), where('senderEmail', '==', currentEmail), orderBy('timestamp', 'desc'));
    const unsub2 = onSnapshot(q2, (snap) => {
      setSent(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      sentLoaded = true;
      checkDone();
    });

    return () => { unsub1(); unsub2(); };
  }, [currentEmail]);

  // Keep transactions aliased for backward compat with stats (earnings = received)
  const transactions = received;

  const stats = useMemo(() => {
    let totalEarned = 0;
    let pending = 0;
    let totalSpent = 0;
    for (const t of received) {
      if (t.status === 'SUCCESS') totalEarned += Number(t.netAmount || 0);
      else if (t.status === 'PENDING') pending += Number(t.netAmount || 0);
    }
    for (const t of sent) {
      if (t.status === 'SUCCESS') totalSpent += Number(t.amount || 0);
    }
    return { totalEarned, pending, totalSpent };
  }, [received, sent]);

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

            {/* Stats row */}

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: AppSpace.md }}>
              <StatCard label="Total Earned" value={`GHS ${stats.totalEarned.toFixed(2)}`} color="#059669" bg="#ecfdf5" />
              <StatCard label="Pending Balance" value={`GHS ${stats.pending.toFixed(2)}`} color="#d97706" bg="#fffbeb" />
            </View>
            {stats.totalSpent > 0 && (
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: AppSpace.md }}>
                <StatCard label="Total Spent (as Customer)" value={`GHS ${stats.totalSpent.toFixed(2)}`} color="#7c3aed" bg="#f5f3ff" />
              </View>
            )}

            {stats.totalCommission > 0 && (
              <View style={{ backgroundColor: '#fff', borderRadius: AppRadius.md, padding: 14, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: AppSpace.md }}>
                <Text style={{ fontWeight: '700', color: AppColors.ink900, marginBottom: 4 }}>Platform Fees Deducted</Text>
                <Text style={{ color: AppColors.ink500, fontSize: 13 }}>
                  Total commission paid to ConnectHub: GHS {stats.totalCommission.toFixed(2)} (10% per job)
                </Text>
              </View>
            )}

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
              <Text style={{ fontSize: 16, color: AppColors.ink500, fontWeight: '700', textAlign: 'center' }}>No earnings yet</Text>
              <Text style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', marginTop: 4 }}>
                Payments you receive will appear here.
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
              <Text style={{ color: AppColors.ink700, marginBottom: 2, fontSize: 13 }}>From: {item.senderName || item.senderEmail}</Text>
              <Text style={{ color: AppColors.ink500, fontSize: 12 }}>Date: {toDisplayDateTime(item.timestamp)}</Text>
              <Text style={{ color: AppColors.ink900, fontWeight: '700', marginTop: 6 }}>Amount: GHS {Number(item.amount || 0).toFixed(2)}</Text>
              <Text style={{ color: '#b91c1c', fontSize: 12, marginTop: 2 }}>Commission: GHS {Number(item.commission || 0).toFixed(2)}</Text>
              <Text style={{ color: '#15803d', fontSize: 12, marginTop: 2 }}>You received: GHS {Number(item.netAmount || 0).toFixed(2)}</Text>
              <Text style={{ color: AppColors.ink500, fontSize: 12, marginTop: 2 }}>Payment method: {item.paymentMethod || 'N/A'}</Text>
              <View style={{ marginTop: 8, alignSelf: 'flex-start', backgroundColor: badge.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ color: badge.color, fontWeight: '700', fontSize: 12 }}>{badge.text}</Text>
              </View>
              <Text style={{ color: '#64748b', fontSize: 11, marginTop: 8 }}>Transaction ID: {item.transactionId}</Text>
            </AppCard>
          );
        }}
      />

      {/* Payments Made section */}
      {sent.length > 0 && (
        <View style={{ paddingHorizontal: AppSpace.lg, paddingBottom: AppSpace.lg }}>
          <Text style={{ fontWeight: '800', fontSize: 16, color: AppColors.ink900, marginBottom: 10 }}>Payments Made</Text>
          {sent.map((item) => {
            const badge = item.status === 'SUCCESS' ? { text: 'SUCCESS', bg: '#dcfce7', color: '#15803d' }
              : item.status === 'PENDING' ? { text: 'PENDING', bg: '#fef9c3', color: '#b45309' }
              : item.status === 'FAILED' ? { text: 'FAILED', bg: '#fee2e2', color: '#b91c1c' }
              : { text: item.status || 'UNKNOWN', bg: '#f3f4f6', color: '#374151' };
            return (
              <AppCard key={item.id} style={{ marginBottom: 12 }}>
                <Text style={{ fontWeight: '800', fontSize: 16, color: AppColors.ink900, marginBottom: 3 }} numberOfLines={1}>{item.jobTitle || 'Job'}</Text>
                <Text style={{ color: AppColors.ink700, marginBottom: 2, fontSize: 13 }}>To: {item.receiverName || item.receiverEmail}</Text>
                <Text style={{ color: AppColors.ink500, fontSize: 12 }}>Date: {toDisplayDateTime(item.timestamp)}</Text>
                <Text style={{ color: AppColors.ink900, fontWeight: '700', marginTop: 6 }}>Amount paid: GHS {Number(item.amount || 0).toFixed(2)}</Text>
                <Text style={{ color: AppColors.ink500, fontSize: 12, marginTop: 2 }}>Payment method: {item.paymentMethod || 'N/A'}</Text>
                <View style={{ marginTop: 8, alignSelf: 'flex-start', backgroundColor: badge.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ color: badge.color, fontWeight: '700', fontSize: 12 }}>{badge.text}</Text>
                </View>
              </AppCard>
            );
          })}
        </View>
      )}
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
