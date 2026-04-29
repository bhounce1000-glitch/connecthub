import { useRouter } from 'expo-router';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';

import AppCard from '../components/ui/app-card';
import LoadingSkeleton from '../components/ui/loading-skeleton';
import { REQUEST_STATUS } from '../constants/access';
import { AppColors, AppRadius, AppSpace } from '../constants/design-tokens';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { toDisplayDateTime } from '../utils/date-time';

export default function Wallet() {
  const router = useRouter();
  const { user } = useAuthUser();
  const [jobs, setJobs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const currentEmail = user?.email || '';

  useEffect(() => {
    if (!currentEmail) return;
    const q = query(collection(db, 'requests'), where('acceptedBy', '==', currentEmail));
    return onSnapshot(q, (snap) => {
      setJobs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setIsLoading(false);
    }, () => setIsLoading(false));
  }, [currentEmail]);

  const stats = useMemo(() => {
    let totalEarned = 0;
    let pending = 0;
    let jobsCompleted = 0;
    let totalCommission = 0;
    for (const j of jobs) {
      if (j.paid) {
        const net = Number(j.providerNet ?? j.price ?? 0);
        const commission = Number(j.commission ?? 0);
        totalEarned += net;
        totalCommission += commission;
        jobsCompleted += 1;
      } else if (j.status === REQUEST_STATUS.COMPLETED || j.status === 'completed') {
        pending += Number(j.price ?? 0);
      }
    }
    return { totalEarned, pending, jobsCompleted, totalCommission };
  }, [jobs]);

  const transactions = useMemo(() => {
    return jobs
      .filter((j) => j.paid)
      .sort((a, b) => (b.paidAt?.seconds ?? 0) - (a.paidAt?.seconds ?? 0));
  }, [jobs]);

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
              <StatCard label="Pending" value={`GHS ${stats.pending.toFixed(2)}`} color="#d97706" bg="#fffbeb" />
              <StatCard label="Jobs Done" value={String(stats.jobsCompleted)} color="#4f46e5" bg="#eef2ff" />
            </View>

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
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>📭</Text>
            <Text style={{ fontSize: 16, color: AppColors.ink500, fontWeight: '700', textAlign: 'center' }}>No completed jobs yet</Text>
            <Text style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', marginTop: 4 }}>
              Accept jobs and complete them to see earnings here.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const net = Number(item.providerNet ?? item.price ?? 0);
          const commission = Number(item.commission ?? 0);
          const gross = Number(item.price ?? 0);
          return (
            <AppCard style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', fontSize: 15, color: AppColors.ink900 }} numberOfLines={1}>{item.title}</Text>
                  <Text style={{ color: AppColors.ink500, fontSize: 12, marginTop: 2 }}>From: {item.user}</Text>
                  {item.paidAt && (
                    <Text style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>{toDisplayDateTime(item.paidAt)}</Text>
                  )}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontWeight: '800', fontSize: 16, color: '#059669' }}>+GHS {net.toFixed(2)}</Text>
                  {commission > 0 && (
                    <Text style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>fee: GHS {commission.toFixed(2)}</Text>
                  )}
                </View>
              </View>
              {gross > 0 && commission > 0 && (
                <View style={{ marginTop: 8, backgroundColor: '#f8fafc', borderRadius: 8, padding: 10 }}>
                  <Text style={{ color: AppColors.ink500, fontSize: 12 }}>
                    Job price: GHS {gross.toFixed(2)} — 10% fee: GHS {commission.toFixed(2)} = Net: GHS {net.toFixed(2)}
                  </Text>
                </View>
              )}
              {item.paymentReference && (
                <Text style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>Ref: {item.paymentReference}</Text>
              )}
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
