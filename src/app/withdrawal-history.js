import { useRouter } from 'expo-router';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, TouchableOpacity, View } from 'react-native';

import LoadingSkeleton from '../components/ui/loading-skeleton';
import ScreenShell from '../components/ui/screen-shell';
import { AppColors, AppRadius, AppShadow, AppSpace } from '../constants/design-tokens';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';

function toMs(value) {
  if (!value) return 0;
  if (value?.seconds) return value.seconds * 1000;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function fmtDate(value) {
  if (!value) return '—';
  const ms = toMs(value);
  if (!ms) return String(value).slice(0, 16);
  const d = new Date(ms);
  return d.toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' });
}

const STATUS_META = {
  PENDING:    { label: '⏳ Pending',     bg: '#fef3c7', text: '#92400e' },
  PROCESSING: { label: '⏳ Processing',  bg: '#dbeafe', text: '#1e40af' },
  COMPLETED:  { label: '✅ Paid',        bg: '#dcfce7', text: '#166534' },
  FAILED:     { label: '❌ Failed',      bg: '#fee2e2', text: '#991b1b' },
  REFUNDED:   { label: '↩ Refunded',    bg: '#f1f5f9', text: '#475569' },
};

function StatusBadge({ status }) {
  const s = String(status || '').toUpperCase();
  const meta = STATUS_META[s] || { label: s || 'Unknown', bg: '#f1f5f9', text: '#475569' };
  return (
    <View style={{ backgroundColor: meta.bg, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, alignSelf: 'flex-start' }}>
      <Text style={{ color: meta.text, fontSize: 11, fontWeight: '700' }}>{meta.label}</Text>
    </View>
  );
}

function WithdrawalCard({ item }) {
  const amount = Number(item.amount || 0);
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: AppRadius.lg, padding: 14, marginBottom: 10, ...AppShadow.card }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <Text style={{ fontWeight: '800', fontSize: 16, color: AppColors.ink900 }}>GHS {amount.toFixed(2)}</Text>
        <StatusBadge status={item.status} />
      </View>

      <Text style={{ fontSize: 13, color: '#374151', fontWeight: '600' }}>
        {item.provider || item.network || 'MoMo'} · {item.phoneNumber || '—'}
      </Text>
      {item.accountName ? (
        <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{item.accountName}</Text>
      ) : null}

      <View style={{ marginTop: 8, gap: 3 }}>
        <Text style={{ fontSize: 11, color: '#94a3b8' }}>
          Submitted: {fmtDate(item.requestedAt || item.requestedAtIso)}
        </Text>
        {item.completedAt ? (
          <Text style={{ fontSize: 11, color: '#94a3b8' }}>
            Completed: {fmtDate(item.completedAt)}
          </Text>
        ) : null}
        {item.failureReason ? (
          <Text style={{ fontSize: 11, color: '#b91c1c', marginTop: 2 }}>Reason: {item.failureReason}</Text>
        ) : null}
        <Text style={{ fontSize: 11, color: '#cbd5e1', marginTop: 2 }} selectable>Ref: {item.reference || item.id}</Text>
      </View>
    </View>
  );
}

export default function WithdrawalHistoryScreen() {
  const { user, loading: authLoading } = useAuthUser();
  const router = useRouter();

  const [withdrawals, setWithdrawals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (authLoading || !user?.email) return;
    setLoading(true);
    setError(null);

    const email = String(user.email).trim().toLowerCase();
    const q = query(
      collection(db, 'wallet_withdrawals'),
      where('userEmail', '==', email),
      orderBy('requestedAt', 'desc')
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setWithdrawals(rows);
        setLoading(false);
      },
      (err) => {
        console.error('withdrawal-history snapshot error:', err);
        setError('Could not load withdrawal history.');
        setLoading(false);
      }
    );
    return () => unsub();
  }, [user?.email, authLoading, refreshKey]);

  const onRefresh = () => setRefreshKey((k) => k + 1);

  if (authLoading || loading) {
    return (
      <ScreenShell eyebrow="WALLET" title="Withdrawal History" accentColor="#1e3a8a" accentTextColor="#dbeafe" backgroundColor="#f8fafc" scroll={false}>
        <LoadingSkeleton rows={5} />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell
      eyebrow="WALLET"
      title="Withdrawal History"
      subtitle={`${withdrawals.length} record${withdrawals.length === 1 ? '' : 's'}`}
      accentColor="#1e3a8a"
      accentTextColor="#dbeafe"
      backgroundColor="#f8fafc"
      scroll={false}
    >
      <FlatList
        data={withdrawals}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <WithdrawalCard item={item} />}
        contentContainerStyle={{ paddingHorizontal: AppSpace.screen, paddingTop: 12, paddingBottom: 40, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 60 }}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>💸</Text>
            <Text style={{ color: AppColors.ink900, fontWeight: '700', fontSize: 16, marginBottom: 6 }}>No withdrawals yet</Text>
            <Text style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>
              Once you request a withdrawal, it will appear here.
            </Text>
          </View>
        }
        ListHeaderComponent={
          error ? (
            <View style={{ backgroundColor: '#fee2e2', borderRadius: AppRadius.md, padding: 10, margin: 16, marginBottom: 0 }}>
              <Text style={{ color: '#991b1b', fontSize: 12 }}>{error}</Text>
            </View>
          ) : null
        }
      />

      <View style={{ padding: AppSpace.screen, paddingTop: 4 }}>
        <TouchableOpacity
          onPress={() => router.replace('/wallet')}
          style={{ backgroundColor: '#f1f5f9', borderRadius: AppRadius.md, paddingVertical: 12, alignItems: 'center' }}
        >
          <Text style={{ color: '#1e3a8a', fontWeight: '700', fontSize: 14 }}>← Back to Wallet</Text>
        </TouchableOpacity>
      </View>
    </ScreenShell>
  );
}
