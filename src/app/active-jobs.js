import { useRouter } from 'expo-router';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppNotice from '../components/ui/app-notice';
import { REQUEST_STATUS } from '../constants/access';
import { API_BASE_URL } from '../constants/api';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { apiPost, assertApiSuccess } from '../utils/api-client';
import jobStateMachine from '../utils/jobStateMachine';

const categories = ['All', 'Cleaning', 'Plumbing', 'Electrical', 'Delivery', 'Moving', 'Cooking', 'Beauty', 'Tech Support', 'Gardening', 'Other'];

function statusLabel(status) {
  if (status === REQUEST_STATUS.ACCEPTED) return 'Accepted';
  if (status === REQUEST_STATUS.IN_PROGRESS) return 'Working';
  if (status === REQUEST_STATUS.PENDING_CONFIRMATION) return 'Done';
  if (status === REQUEST_STATUS.COMPLETED) return 'Confirmed';
  if (status === REQUEST_STATUS.PAID) return 'Paid';
  return 'Open';
}

export default function ActiveJobs() {
  const router = useRouter();
  const { user } = useAuthUser();
  const currentEmail = String(user?.email || '').toLowerCase();

  const [tab, setTab] = useState('available');
  const [category, setCategory] = useState('All');
  const [openJobs, setOpenJobs] = useState([]);
  const [myJobs, setMyJobs] = useState([]);
  const [loadingId, setLoadingId] = useState('');
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'requests'), where('status', '==', REQUEST_STATUS.OPEN)), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setOpenJobs(rows);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!currentEmail) return undefined;
    const mine = query(collection(db, 'requests'), where('acceptedBy', '==', currentEmail));
    const unsub = onSnapshot(mine, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setMyJobs(rows);
    });
    return unsub;
  }, [currentEmail]);

  const availableFiltered = useMemo(() => {
    return openJobs.filter((job) => category === 'All' || String(job.category || '').trim() === category);
  }, [openJobs, category]);

  const completedJobs = useMemo(() => {
    return myJobs.filter((job) => [REQUEST_STATUS.COMPLETED, REQUEST_STATUS.PAID].includes(job.status) || job.paid);
  }, [myJobs]);

  const list = tab === 'available' ? availableFiltered : (tab === 'mine' ? myJobs : completedJobs);

  const handleAccept = async (item) => {
    setLoadingId(`${item.id}:accept`);
    setNotice(null);
    try {
      jobStateMachine.canTransition('open', 'accepted', 'provider', { jobId: item.id, userId: currentEmail });
      const { response, data } = await apiPost(`${API_BASE_URL}/jobs/${item.id}/accept`, {}, { requireAuth: true });
      assertApiSuccess(response, data, 'Could not accept this job');
      setNotice({ tone: 'success', title: 'Job accepted', message: 'This job is now in your My Jobs tab.' });
      setTab('mine');
    } catch (error) {
      setNotice({ tone: 'error', title: 'Accept failed', message: error?.message || 'Could not accept this job.' });
    } finally {
      setLoadingId('');
    }
  };

  const handleStartWorking = async (item) => {
    setLoadingId(`${item.id}:start`);
    try {
      jobStateMachine.canTransition('accepted', 'working', 'system', { jobId: item.id, userId: currentEmail });
      const { response, data } = await apiPost(`${API_BASE_URL}/jobs/${item.id}/start-working`, {}, { requireAuth: true });
      assertApiSuccess(response, data, 'Could not start this job');
    } finally {
      setLoadingId('');
    }
  };

  const handleDone = async (item) => {
    setLoadingId(`${item.id}:done`);
    try {
      jobStateMachine.canTransition('working', 'done', 'provider', { jobId: item.id, userId: currentEmail });
      const { response, data } = await apiPost(`${API_BASE_URL}/jobs/${item.id}/mark-complete`, {}, { requireAuth: true });
      assertApiSuccess(response, data, 'Could not mark as done');
    } finally {
      setLoadingId('');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc', padding: 16 }}>
      <Text style={{ color: '#0f172a', fontSize: 26, fontWeight: '900' }}>Active Jobs</Text>

      <View style={{ flexDirection: 'row', marginTop: 12, marginBottom: 10 }}>
        <Tab text="Available" active={tab === 'available'} onPress={() => setTab('available')} />
        <Tab text="My Jobs" active={tab === 'mine'} onPress={() => setTab('mine')} />
        <Tab text="Completed" active={tab === 'completed'} onPress={() => setTab('completed')} />
      </View>

      <AppNotice tone={notice?.tone} title={notice?.title} message={notice?.message} style={{ marginBottom: 10 }} />

      {tab === 'available' ? (
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={categories}
          keyExtractor={(item) => item}
          style={{ marginBottom: 10 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => setCategory(item)}
              style={{
                borderWidth: 1,
                borderColor: category === item ? '#2563eb' : '#cbd5e1',
                backgroundColor: category === item ? '#dbeafe' : '#fff',
                borderRadius: 999,
                paddingHorizontal: 12,
                paddingVertical: 8,
                marginRight: 8,
              }}
            >
              <Text style={{ color: '#0f172a', fontWeight: '700', fontSize: 12 }}>{item}</Text>
            </TouchableOpacity>
          )}
        />
      ) : null}

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={{ color: '#64748b', marginTop: 20 }}>No jobs here yet.</Text>}
        renderItem={({ item }) => {
          const status = String(item.status || REQUEST_STATUS.OPEN);
          return (
            <View style={{ backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', padding: 12, marginBottom: 10 }}>
              <Text style={{ color: '#0f172a', fontWeight: '900' }}>{item.title}</Text>
              <Text style={{ color: '#64748b', marginTop: 4 }}>{item.category || 'Other'} • GHS {Number(item.price || 0).toFixed(2)}</Text>
              <Text style={{ color: '#334155', marginTop: 4 }}>Status: {statusLabel(status)}</Text>

              {tab === 'available' ? (
                <AppButton label="Accept Job" onPress={() => handleAccept(item)} loading={loadingId === `${item.id}:accept`} style={{ marginTop: 8 }} />
              ) : null}

              {tab === 'mine' && status === REQUEST_STATUS.ACCEPTED ? (
                <AppButton
                  label={item.escrowFunded ? 'Start Working' : 'Awaiting customer payment'}
                  onPress={() => handleStartWorking(item)}
                  disabled={!item.escrowFunded}
                  loading={loadingId === `${item.id}:start`}
                  style={{ marginTop: 8 }}
                />
              ) : null}

              {tab === 'mine' && status === REQUEST_STATUS.IN_PROGRESS ? (
                <AppButton label="Mark as Done" onPress={() => handleDone(item)} loading={loadingId === `${item.id}:done`} style={{ marginTop: 8 }} />
              ) : null}

              {tab === 'mine' && status === REQUEST_STATUS.PENDING_CONFIRMATION ? (
                <Text style={{ marginTop: 8, color: '#b45309', fontWeight: '800' }}>Awaiting customer confirmation</Text>
              ) : null}

              {tab === 'mine' && (status === REQUEST_STATUS.COMPLETED || status === REQUEST_STATUS.PAID || item.paid) ? (
                <Text style={{ marginTop: 8, color: '#166534', fontWeight: '800' }}>Payment released to wallet ✅</Text>
              ) : null}

              <AppButton
                label="View Details"
                variant="neutral"
                onPress={() => router.push({ pathname: '/job-details', params: { requestId: item.id } })}
                style={{ marginTop: 8 }}
              />
            </View>
          );
        }}
      />
    </View>
  );
}

function Tab({ text, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        flex: 1,
        borderBottomWidth: 2,
        borderBottomColor: active ? '#2563eb' : 'transparent',
        alignItems: 'center',
        paddingVertical: 10,
      }}
    >
      <Text style={{ color: active ? '#2563eb' : '#64748b', fontWeight: '900' }}>{text}</Text>
    </TouchableOpacity>
  );
}
