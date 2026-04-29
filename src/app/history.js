import { useRouter } from 'expo-router';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';

import AppCard from '../components/ui/app-card';
import Avatar from '../components/ui/avatar';
import { REQUEST_STATUS } from '../constants/access';
import { AppColors, AppRadius, AppSpace } from '../constants/design-tokens';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { toDisplayDateTime } from '../utils/date-time';

const HISTORY_STATUSES = [REQUEST_STATUS.COMPLETED, REQUEST_STATUS.PAID, REQUEST_STATUS.DISPUTED, REQUEST_STATUS.CANCELLED];

function statusBadge(status) {
  if (status === REQUEST_STATUS.DISPUTED) return { text: 'Disputed ⚠️', bg: '#fef2f2', color: '#b91c1c' };
  if (status === REQUEST_STATUS.CANCELLED) return { text: 'Cancelled ❌', bg: '#f3f4f6', color: '#374151' };
  return { text: 'Completed ✅', bg: '#ecfdf5', color: '#166534' };
}

export default function History() {
  const router = useRouter();
  const { user } = useAuthUser();
  const currentEmail = user?.email || '';

  const [jobs, setJobs] = useState([]);
  const [profiles, setProfiles] = useState({});

  useEffect(() => {
    if (!currentEmail) return;

    const requestsRef = collection(db, 'requests');
    const ownQ = query(requestsRef, where('user', '==', currentEmail));
    const workerQ = query(requestsRef, where('acceptedBy', '==', currentEmail));

    const snapState = { own: null, worker: null };
    const emit = () => {
      if (!snapState.own || !snapState.worker) return;
      const map = new Map();
      [snapState.own, snapState.worker].forEach((snap) => {
        snap.docs.forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));
      });
      const merged = [...map.values()]
        .filter((item) => HISTORY_STATUSES.includes(item.status) || item.paid)
        .sort((a, b) => {
          const aTs = a.paidAt || a.completedAt || a.cancelledAt || a.disputeOpenedAt || a.createdAt?.seconds || 0;
          const bTs = b.paidAt || b.completedAt || b.cancelledAt || b.disputeOpenedAt || b.createdAt?.seconds || 0;
          return String(bTs).localeCompare(String(aTs));
        });
      setJobs(merged);
    };

    const u1 = onSnapshot(ownQ, (s) => { snapState.own = s; emit(); });
    const u2 = onSnapshot(workerQ, (s) => { snapState.worker = s; emit(); });
    return () => { u1(); u2(); };
  }, [currentEmail]);

  useEffect(() => {
    const emails = new Set();
    jobs.forEach((job) => {
      if (job.user) emails.add(job.user);
      if (job.acceptedBy) emails.add(job.acceptedBy);
    });

    const missing = [...emails].filter((email) => !profiles[email]);
    if (!missing.length) return;

    Promise.all(
      missing.map(async (email) => {
        try {
          const snap = await getDoc(doc(db, 'users', email));
          return [email, snap.exists() ? snap.data() : {}];
        } catch {
          return [email, {}];
        }
      })
    ).then((rows) => {
      setProfiles((prev) => {
        const next = { ...prev };
        rows.forEach(([email, data]) => {
          next[email] = data;
        });
        return next;
      });
    });
  }, [jobs, profiles]);

  const rows = useMemo(() => {
    return jobs.map((job) => {
      const isOwner = job.user === currentEmail;
      const otherEmail = isOwner ? job.acceptedBy : job.user;
      const otherProfile = profiles[otherEmail] || {};
      return {
        ...job,
        otherEmail,
        otherName: otherProfile.name || otherEmail || 'Unavailable',
        otherPhoto: otherProfile.profilePicture || null,
      };
    });
  }, [currentEmail, jobs, profiles]);

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <FlatList
        contentContainerStyle={{ padding: AppSpace.lg }}
        data={rows}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={{ marginBottom: AppSpace.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 10 }}>
                <Text style={{ fontSize: 22, color: '#4f46e5' }}>←</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 25, color: AppColors.ink900, fontWeight: '800' }}>Job History</Text>
            </View>
            <Text style={{ color: AppColors.ink500 }}>All your past jobs are stored permanently for trust and transparency.</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <Text style={{ fontSize: 40, marginBottom: 8 }}>📂</Text>
            <Text style={{ color: AppColors.ink500 }}>No history records yet.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const badge = statusBadge(item.status);
          const completedDate = item.paidAt || item.completedAt || item.cancelledAt || item.disputeOpenedAt;
          return (
            <AppCard style={{ marginBottom: 12 }}>
              <Text style={{ fontWeight: '800', fontSize: 16, color: AppColors.ink900, marginBottom: 3 }} numberOfLines={1}>{item.title}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <Avatar src={item.otherPhoto} email={item.otherEmail} size={22} />
                <Text style={{ color: AppColors.ink700, marginLeft: 8, fontSize: 12 }}>with {item.otherName}</Text>
              </View>
              <Text style={{ color: AppColors.ink500, fontSize: 12 }}>Date: {completedDate ? toDisplayDateTime(completedDate) : 'Unavailable'}</Text>
              <Text style={{ color: AppColors.ink500, fontSize: 12, marginTop: 2 }}>Amount: GHS {item.price || 0}</Text>
              <Text style={{ color: AppColors.ink500, fontSize: 12, marginTop: 2 }}>Rating: {item.rating ? `${item.rating} ★` : 'No rating yet'}</Text>

              <View style={{ marginTop: 8, alignSelf: 'flex-start', backgroundColor: badge.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ color: badge.color, fontWeight: '700', fontSize: 12 }}>{badge.text}</Text>
              </View>

              <TouchableOpacity
                onPress={() => router.push({ pathname: '/job-details', params: { requestId: item.id } })}
                style={{ marginTop: 10, backgroundColor: '#eef2ff', borderRadius: AppRadius.md, paddingVertical: 10, alignItems: 'center' }}
              >
                <Text style={{ color: '#4338ca', fontWeight: '700' }}>View Details</Text>
              </TouchableOpacity>
            </AppCard>
          );
        }}
      />
    </View>
  );
}
