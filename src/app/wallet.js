import { useLocalSearchParams, useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
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

function rowTime(row) {
  return toMs(row?.timestamp) || toMs(row?.createdAt);
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

function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function isWithdrawalRow(row) {
  return String(row.type || '').toLowerCase() === 'withdrawal'
    || String(row.paymentMethod || '').toLowerCase().includes('withdraw')
    || String(row.reference || '').toUpperCase().startsWith('WD_');
}

function humanizeTransactionStatus(row) {
  const status = normalizeStatus(row.status);
  if (status === 'pending_admin_approval' || status === 'manual_review' || status === 'pending') {
    return { label: '⏳ Awaiting Processing', color: '#b45309' };
  }
  if (status === 'processing') {
    return { label: '⏳ Sending to MoMo...', color: '#b45309' };
  }
  if (status === 'completed' || status === 'success') {
    return isWithdrawalRow(row)
      ? { label: '✅ Sent to MoMo', color: '#166534' }
      : { label: '✅ Completed', color: '#166534' };
  }
  if (status === 'failed') {
    return { label: '❌ Failed — Balance Restored', color: '#b91c1c' };
  }
  if (status === 'rejected') {
    return { label: '❌ Rejected — Balance Restored', color: '#b91c1c' };
  }
  return { label: String(row.status || 'Processing'), color: '#475569' };
}

function humanizePaymentMethod(value) {
  const method = String(value || '').trim();
  if (!method) return 'N/A';
  if (method.toLowerCase() === 'manual transfer queue') {
    return 'MoMo Transfer (Manual)';
  }
  return method;
}

function computeStats(txList, userEmail) {
  let earned = 0;
  let pending = 0;
  let withdrawn = 0;

  for (const tx of txList) {
    const amount = parseFloat(tx.amount || tx.netAmount || 0);
    const status = String(tx.status || '').toLowerCase();
    const type = String(tx.type || '').toLowerCase();

    if (type === 'withdrawal' && (status === 'completed' || status === 'success')) {
      withdrawn += amount;
      continue;
    }

    if (status === 'pending' || status === 'pending_admin_approval' || status === 'manual_review' || status === 'processing') {
      pending += amount;
      continue;
    }

    if (type !== 'withdrawal' && (status === 'completed' || status === 'success' || status === 'paid' || status === 'released')) {
      if (tx.receiverEmail === userEmail || tx.direction === 'received' || (tx.senderEmail !== userEmail && !type.includes('withdraw'))) {
        earned += amount;
      }
    }
  }

  return { earned, pending, withdrawn };
}

function transactionCounterparty(row, currentEmail) {
  if (isWithdrawalRow(row)) {
    return `To: ${String(row.accountName || row.provider || 'Your MoMo Wallet').toUpperCase()}`;
  }

  if (String(row.senderEmail || '').trim().toLowerCase() === currentEmail) {
    return `To: ${String(row.receiverName || row.receiverEmail || row.reference || 'Unknown').toUpperCase()}`;
  }

  return `From: ${String(row.senderName || row.senderEmail || row.reference || 'Unknown').toUpperCase()}`;
}

export default function Wallet() {
  const router = useRouter();
  const { refresh } = useLocalSearchParams();
  const { user } = useAuthUser();
  const currentEmail = (user?.email || '').trim().toLowerCase();
  const currentUid = String(user?.uid || '').trim();

  const [transactions, setTransactions] = useState([]);
  const [walletBalance, setWalletBalance] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [activityFilter, setActivityFilter] = useState('all');

  const handleWithdraw = () => {
    router.push('/wallet-withdraw');
  };

  const handleAddMoney = () => {
    router.push('/wallet-topup');
  };

  const loadWallet = async () => {
    if (!currentEmail) {
      setTransactions([]);
      setWalletBalance(0);
      setIsLoading(false);
      return;
    }

    setErrorMessage('');
    try {
      let balance = 0;
      if (currentUid) {
        const walletByUid = await getDoc(doc(db, 'wallets', currentUid));
        if (walletByUid.exists()) {
          balance = Number(walletByUid.data()?.balance || walletByUid.data()?.walletBalance || 0);
        }
      }
      if (!balance && currentEmail) {
        const walletByEmail = await getDoc(doc(db, 'wallets', currentEmail));
        if (walletByEmail.exists()) {
          balance = Number(walletByEmail.data()?.balance || walletByEmail.data()?.walletBalance || 0);
        }
      }
      if (!balance) {
        const userSnap = await getDoc(doc(db, 'users', currentEmail));
        balance = userSnap.exists() ? Number(userSnap.data()?.walletBalance || 0) : 0;
      }

      const byUserIdQ = currentUid
        ? query(collection(db, 'transactions'), where('userId', '==', currentUid), orderBy('createdAt', 'desc'), limit(50))
        : null;
      const sentQ = query(collection(db, 'transactions'), where('senderEmail', '==', currentEmail), orderBy('timestamp', 'desc'), limit(50));
      const receivedQ = query(collection(db, 'transactions'), where('receiverEmail', '==', currentEmail), orderBy('timestamp', 'desc'), limit(50));
      const [userIdSnap, sentSnap, receivedSnap] = await Promise.all([
        byUserIdQ ? getDocs(byUserIdQ) : Promise.resolve({ docs: [] }),
        getDocs(sentQ),
        getDocs(receivedQ),
      ]);

      const userIdRows = userIdSnap.docs.map((d) => ({ id: d.id, ...d.data(), direction: d.data()?.type === 'credit' ? 'received' : 'sent' }));
      const sentRows = sentSnap.docs.map((d) => ({ id: d.id, ...d.data(), direction: 'sent' }));
      const receivedRows = receivedSnap.docs.map((d) => ({ id: d.id, ...d.data(), direction: 'received' }));

      const byId = new Map();
      [...userIdRows, ...sentRows, ...receivedRows].forEach((row) => byId.set(row.id, row));
      const merged = Array.from(byId.values()).sort((a, b) => rowTime(b) - rowTime(a));

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
  }, [currentEmail, refresh]);

  useEffect(() => {
    if (!currentEmail && !currentUid) return undefined;
    const refPath = currentUid ? doc(db, 'wallets', currentUid) : doc(db, 'wallets', currentEmail);
    const unsubWallet = onSnapshot(refPath, (snap) => {
      const balance = snap.exists() ? Number(snap.data()?.balance || snap.data()?.walletBalance || 0) : 0;
      setWalletBalance(Number.isFinite(balance) ? balance : 0);
    });
    return unsubWallet;
  }, [currentEmail, currentUid]);

  useEffect(() => {
    if (!currentEmail) return undefined;
    const unsub = onSnapshot(doc(db, 'users', currentEmail), (snap) => {
      if (snap.exists()) {
        setWalletBalance(parseFloat(snap.data()?.walletBalance || 0));
      }
    });
    return unsub;
  }, [currentEmail]);

  useEffect(() => {
    if (!currentEmail) return undefined;

    const sentQ = query(collection(db, 'transactions'), where('senderEmail', '==', currentEmail), orderBy('timestamp', 'desc'), limit(50));
    const receivedQ = query(collection(db, 'transactions'), where('receiverEmail', '==', currentEmail), orderBy('timestamp', 'desc'), limit(50));

    let sentRows = [];
    let receivedRows = [];

    const mergeRows = () => {
      const byId = new Map();
      [...sentRows, ...receivedRows].forEach((row) => byId.set(row.id, row));
      const merged = Array.from(byId.values()).sort((a, b) => rowTime(b) - rowTime(a));
      setTransactions(merged);
    };

    const unsubSent = onSnapshot(sentQ, (snap) => {
      sentRows = snap.docs.map((d) => ({ id: d.id, ...d.data(), direction: 'sent' }));
      mergeRows();
    });

    const unsubReceived = onSnapshot(receivedQ, (snap) => {
      receivedRows = snap.docs.map((d) => ({ id: d.id, ...d.data(), direction: 'received' }));
      mergeRows();
    });

    return () => {
      unsubSent();
      unsubReceived();
    };
  }, [currentEmail]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadWallet();
  };

  const stats = useMemo(() => computeStats(transactions, currentEmail), [currentEmail, transactions]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((row) => {
      const withdrawal = isWithdrawalRow(row);
      const isReceived = row.direction === 'received' && !withdrawal;
      const isSent = row.direction === 'sent' && !withdrawal;

      if (activityFilter === 'received') return isReceived;
      if (activityFilter === 'sent') return isSent;
      if (activityFilter === 'withdrawals') return withdrawal;
      return true;
    });
  }, [activityFilter, transactions]);

  const grouped = useMemo(() => {
    const map = new Map();
    filteredTransactions.forEach((row) => {
      const label = groupLabel(rowTime(row));
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(row);
    });
    return Array.from(map.entries());
  }, [filteredTransactions]);

  const emptyStateCopy = useMemo(() => {
    if (activityFilter === 'received') {
      return { icon: '📥', title: 'No incoming payments yet', subtitle: 'Completed jobs and top-ups will appear here.' };
    }
    if (activityFilter === 'sent') {
      return { icon: '📤', title: 'No outgoing payments yet', subtitle: 'Transfers you make to others will appear here.' };
    }
    if (activityFilter === 'withdrawals') {
      return { icon: '🏧', title: 'No withdrawals yet', subtitle: 'Your MoMo cash-outs will appear here once created.' };
    }
    return { icon: '👛', title: 'Your wallet is empty', subtitle: 'Complete jobs to earn GHS.' };
  }, [activityFilter]);

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
                <TouchableOpacity onPress={handleWithdraw} style={{ flex: 1, borderWidth: 1, borderColor: '#fff', borderRadius: AppRadius.md, paddingVertical: 10, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '800' }}>Withdraw</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleAddMoney} style={{ flex: 1, borderRadius: AppRadius.md, paddingVertical: 10, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.14)' }}>
                  <Text style={{ color: '#fff', fontWeight: '800' }}>Add Money</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => router.push('/withdrawal-history')} style={{ marginTop: 10, alignItems: 'center' }}>
                <Text style={{ color: '#93c5fd', fontSize: 12, fontWeight: '600' }}>View withdrawal history →</Text>
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              <QuickStat label="Total Earned" value={`GHS ${stats.earned.toFixed(2)}`} />
              <QuickStat label="Pending" value={`GHS ${stats.pending.toFixed(2)}`} />
              <QuickStat label="Withdrawn" value={`GHS ${stats.withdrawn.toFixed(2)}`} />
            </View>

            <View style={{ backgroundColor: walletBalance > 0 ? '#ecfdf5' : '#eff6ff', borderRadius: AppRadius.md, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: walletBalance > 0 ? '#bbf7d0' : '#bfdbfe' }}>
              <Text style={{ color: walletBalance > 0 ? '#166534' : '#1d4ed8', fontWeight: '800', marginBottom: 4 }}>
                {walletBalance > 0 ? 'Balance ready for use' : 'Wallet ready for your first payout'}
              </Text>
              <Text style={{ color: walletBalance > 0 ? '#15803d' : '#2563eb', fontSize: 12 }}>
                {walletBalance > 0
                  ? 'You can withdraw available funds or keep them for future platform payments.'
                  : 'Top up or complete a job to start seeing funds and transaction history here.'}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
              {[
                { key: 'all', label: 'All' },
                { key: 'received', label: 'Money In' },
                { key: 'sent', label: 'Money Out' },
                { key: 'withdrawals', label: 'Withdrawals' },
              ].map((item) => {
                const active = activityFilter === item.key;
                return (
                  <TouchableOpacity
                    key={item.key}
                    onPress={() => setActivityFilter(item.key)}
                    style={{
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: active ? '#2563eb' : '#cbd5e1',
                      backgroundColor: active ? '#dbeafe' : '#fff',
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      marginRight: 8,
                      marginBottom: 6,
                    }}
                  >
                    <Text style={{ color: active ? '#1d4ed8' : '#64748b', fontWeight: '700', fontSize: 12 }}>{item.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {errorMessage ? (
              <View style={{ backgroundColor: '#fee2e2', borderRadius: AppRadius.md, padding: 10, marginBottom: 10 }}>
                <Text style={{ color: '#991b1b', fontSize: 12 }}>{errorMessage}</Text>
              </View>
            ) : null}

            <Text style={{ marginBottom: 10, color: AppColors.ink900, fontWeight: '900', fontSize: 16 }}>
              Transaction History ({filteredTransactions.length})
            </Text>
          </>
        )}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingVertical: 48 }}>
            <Text style={{ fontSize: 64 }}>{emptyStateCopy.icon}</Text>
            <Text style={{ marginTop: 10, fontWeight: '800', color: AppColors.ink900, fontSize: 18 }}>{emptyStateCopy.title}</Text>
            <Text style={{ color: '#64748b', marginTop: 6 }}>{emptyStateCopy.subtitle}</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const [label, rows] = item;
          return (
            <View style={{ marginBottom: 14 }}>
              {index > 0 ? <View style={{ height: 1, backgroundColor: '#e2e8f0', marginBottom: 10 }} /> : null}
              <Text style={{ fontWeight: '800', color: '#475569', marginBottom: 8 }}>{label}</Text>
              {rows.map((row) => {
                const isWithdrawal = isWithdrawalRow(row);
                const isReceived = row.direction === 'received' && !isWithdrawal;
                const icon = isReceived ? '💰' : isWithdrawal ? '💸' : '⏳';
                const iconBg = isReceived ? '#dcfce7' : isWithdrawal ? '#ffedd5' : '#fee2e2';
                const iconColor = isReceived ? '#166534' : isWithdrawal ? '#c2410c' : '#b91c1c';
                const amountColor = isReceived ? '#166534' : '#b91c1c';
                const statusMeta = humanizeTransactionStatus(row);
                const counterparty = transactionCounterparty(row, currentEmail);
                const title = isWithdrawal ? 'Withdrawal' : (row.description || row.jobTitle || row.type || 'Transaction');
                const subtitle = isWithdrawal
                  ? `Amount sent: GHS ${Number(row.amount || 0).toFixed(2)}`
                  : counterparty;

                return (
                  <View key={row.id} style={{ backgroundColor: '#fff', borderRadius: AppRadius.md, borderWidth: 1, borderColor: '#e2e8f0', padding: 12, marginBottom: 8, ...AppShadow.card }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                        <Text style={{ color: iconColor, fontWeight: '900' }}>{icon}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: AppColors.ink900, fontWeight: '800' }}>{title}</Text>
                        <Text style={{ color: '#475569', fontSize: 12 }} numberOfLines={1}>{subtitle}</Text>
                        <Text style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }} numberOfLines={1}>{humanizePaymentMethod(row.paymentMethod)}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: amountColor, fontWeight: '800' }}>{isReceived ? '+' : '-'} GHS {Number(row.amount || 0).toFixed(2)}</Text>
                        <Text style={{ color: '#94a3b8', fontSize: 11 }}>{toDisplayDateTime(row.timestamp)}</Text>
                      </View>
                    </View>
                    <View style={{ marginTop: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: statusMeta.color, fontSize: 12, fontWeight: '800' }}>{statusMeta.label}</Text>
                      <Text style={{ color: '#94a3b8', fontSize: 11 }}>{row.transactionId || row.reference || row.id}</Text>
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
