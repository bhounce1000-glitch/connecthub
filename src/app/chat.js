import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Text, TouchableOpacity, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppInput from '../components/ui/app-input';
import AppNotice from '../components/ui/app-notice';
import Avatar from '../components/ui/avatar';
import EmptyState from '../components/ui/empty-state';
import LoadingSkeleton from '../components/ui/loading-skeleton';
import ScreenShell from '../components/ui/screen-shell';
import { API_BASE_URL } from '../constants/api';

// Firebase
import { addDoc, collection, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { apiPost } from '../utils/api-client';
import { getCurrentLocation, openBestNavigation, reverseGeocode } from '../utils/location';

const QUICK_REPLIES = [
  'I am on my way.',
  'Please share your exact location.',
  'Can we confirm the final price?',
  'I have completed the work.',
];

export default function Chat() {
  const router = useRouter();
  const { requestId, jobId } = useLocalSearchParams();
  const { user, isAuthReady } = useAuthUser();
  const resolvedRequestId = Array.isArray(requestId)
    ? requestId[0]
    : requestId || (Array.isArray(jobId) ? jobId[0] : jobId);
  const currentEmail = String(user?.email || '').trim().toLowerCase();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [jobTitle, setJobTitle] = useState('Chat');
  const [counterpartyEmail, setCounterpartyEmail] = useState('');
  const [counterpartyName, setCounterpartyName] = useState('');
  const [notice, setNotice] = useState(
    resolvedRequestId
      ? null
      : {
        tone: 'warning',
        title: 'Missing request context',
        message: 'Open a request chat from a specific request to start messaging.',
      }
  );
  const [senderProfiles, setSenderProfiles] = useState({});
  const flatListRef = useRef(null);
  const fetchedProfileEmails = useRef(new Set());
  // Cache the request participants so we know who to notify
  const requestParticipants = useRef({ user: null, acceptedBy: null });

  // Redirect unauthenticated users
  useEffect(() => {
    if (isAuthReady && !user) {
      router.replace('/auth');
    }
  }, [isAuthReady, router, user]);

  const normalizedText = text.trim();

  useEffect(() => {
    if (!resolvedRequestId) {
      return undefined;
    }

    // Load request participants so we can notify the other party on send
    getDoc(doc(db, 'requests', resolvedRequestId))
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          const ownerEmail = String(data.user || '').trim().toLowerCase();
          const providerEmail = String(data.acceptedBy || '').trim().toLowerCase();
          const nextCounterparty = currentEmail === ownerEmail ? providerEmail : ownerEmail;

          requestParticipants.current = {
            user: ownerEmail || null,
            acceptedBy: providerEmail || null,
          };

          setJobTitle(data.title || 'Request Chat');
          setCounterpartyEmail(nextCounterparty || '');

          if (nextCounterparty) {
            getDoc(doc(db, 'users', nextCounterparty))
              .then((profileSnap) => {
                if (profileSnap.exists()) {
                  const profile = profileSnap.data() || {};
                  setCounterpartyName(profile.name || profile.displayName || nextCounterparty);
                } else {
                  setCounterpartyName(nextCounterparty);
                }
              })
              .catch(() => setCounterpartyName(nextCounterparty));
          }
        }
      })
      .catch(() => {/* non-blocking */});

    const q = query(
      collection(db, 'chats', resolvedRequestId, 'messages'),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((chatDoc) => ({ id: chatDoc.id, ...chatDoc.data() }));
        setMessages(data);

        const unreadFromOther = snapshot.docs.filter((chatDoc) => {
          const row = chatDoc.data() || {};
          const sender = String(row.senderEmail || row.user || '').trim().toLowerCase();
          return sender && sender !== currentEmail && row.read !== true;
        });

        unreadFromOther.forEach((chatDoc) => {
          updateDoc(doc(db, 'chats', resolvedRequestId, 'messages', chatDoc.id), {
            read: true,
          }).catch(() => {
            // Non-blocking: read receipts should not interrupt chat.
          });
        });

        setIsLoading(false);
      },
      (error) => {
        setIsLoading(false);
        const isPermissionDenied = error?.code === 'permission-denied';
        setNotice({
          tone: 'error',
          title: 'Unable to load chat',
          message: isPermissionDenied
            ? 'You can only chat if you are the request owner, the accepted provider, or an admin.'
            : (error?.message || 'Could not load messages for this request.'),
        });
      }
    );

    return unsubscribe;
  }, [resolvedRequestId, currentEmail]);

  useEffect(() => {
    const loadSenderProfiles = async () => {
      const uniqueUsers = [...new Set(messages.map((message) => message.senderEmail || message.user).filter(Boolean))];
      const toFetch = uniqueUsers.filter((email) => !fetchedProfileEmails.current.has(email));
      if (!toFetch.length) return;
      toFetch.forEach((email) => fetchedProfileEmails.current.add(email));

      try {
        const entries = await Promise.all(
          toFetch.map(async (userEmail) => {
            const snapshot = await getDoc(doc(db, 'users', userEmail));
            return [userEmail, snapshot.exists() ? snapshot.data() : null];
          })
        );

        setSenderProfiles((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      } catch {
        // Non-blocking: chat still renders with initials when profile docs are missing.
      }
    };

    loadSenderProfiles();
  }, [messages]);

  // Scroll to latest message whenever messages change
  useEffect(() => {
    if (messages.length > 0) {
      flatListRef.current?.scrollToEnd({ animated: false });
    }
  }, [messages]);

  const sendMessage = async () => {
    if (!resolvedRequestId) {
      setNotice({
        tone: 'warning',
        title: 'Missing request context',
        message: 'Open a request chat from a specific request to start messaging.',
      });
      return;
    }

    if (!normalizedText) {
      setNotice({
        tone: 'warning',
        title: 'Message is empty',
        message: 'Type a message before sending.',
      });
      return;
    }

    setIsSending(true);
    setNotice(null);

    try {
      await addDoc(collection(db, 'chats', resolvedRequestId, 'messages'), {
        senderEmail: auth.currentUser?.email,
        text: normalizedText,
        user: auth.currentUser?.email,
        timestamp: new Date(),
        createdAt: new Date(),
        read: false,
      });

      await apiPost(`${API_BASE_URL}/chat/notify`, {
        jobId: resolvedRequestId,
        senderEmail: auth.currentUser?.email,
        messageText: normalizedText,
      }, { requireAuth: true });
    } catch (error) {
      const isPermissionDenied = error?.code === 'permission-denied';
      setNotice({
        tone: 'error',
        title: 'Message not sent',
        message: isPermissionDenied
          ? 'You can only chat if you are the request owner, the accepted provider, or an admin.'
          : (error.message || 'Unable to send your message right now.'),
      });
      return;
    } finally {
      setIsSending(false);
    }

    setText('');
    // Scroll to the new message
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const shareLocationInChat = async () => {
    if (!resolvedRequestId) return;
    try {
      const pos = await getCurrentLocation();
      if (!pos) {
        Alert.alert('Location Error', 'Could not get your current location. Please try again.');
        return;
      }
      const address = await reverseGeocode(pos.latitude, pos.longitude);
      await addDoc(collection(db, 'chats', resolvedRequestId, 'messages'), {
        senderEmail: auth.currentUser?.email,
        user: auth.currentUser?.email,
        type: 'location',
        latitude: pos.latitude,
        longitude: pos.longitude,
        address: address || `${pos.latitude.toFixed(5)}, ${pos.longitude.toFixed(5)}`,
        text: '',
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
        read: false,
      });
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (error) {
      Alert.alert('Could not share location', error.message || 'Please try again.');
    }
  };

  const handleAttachPress = () => {
    Alert.alert('Share', 'What would you like to share?', [
      {
        text: '\uD83D\uDCCD Share My Location',
        onPress: shareLocationInChat,
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const MessageBubble = ({ item }) => {
    const sender = item.senderEmail || item.user;
    const isMe = sender === auth.currentUser?.email;
    const userProfile = senderProfiles[sender];
    const sentAt = item.timestamp || item.createdAt;
    let sentAtLabel = '';
    if (sentAt) {
      try {
        const parsed = typeof sentAt?.toDate === 'function'
          ? sentAt.toDate()
          : new Date(sentAt);
        if (!Number.isNaN(parsed.getTime())) {
          sentAtLabel = parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
      } catch {
        sentAtLabel = '';
      }
    }

    // Location message bubble
    if (item.type === 'location') {
      return (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: isMe ? 'flex-end' : 'flex-start',
            marginVertical: 8,
            alignItems: 'flex-end',
          }}
        >
          {!isMe && (
            <Avatar
              src={userProfile?.profilePicture}
              email={item.user}
              size={32}
              style={{ marginRight: 8 }}
            />
          )}
          <TouchableOpacity
            onPress={() =>
              openBestNavigation(
                Number(item.latitude),
                Number(item.longitude),
                item.address || 'Shared Location'
              )
            }
            activeOpacity={0.8}
            accessibilityLabel="Open shared location in Maps"
            style={{
              backgroundColor: isMe ? '#1d4ed8' : '#e5e7eb',
              padding: 12,
              borderRadius: 14,
              maxWidth: '75%',
              borderWidth: 1,
              borderColor: isMe ? '#3b82f6' : '#d1d5db',
            }}
          >
            {!isMe && (
              <Text style={{ fontSize: 10, color: '#6b7280', marginBottom: 3 }}>
                {sender?.split('@')[0]}
              </Text>
            )}
            <Text style={{ fontSize: 18, marginBottom: 4 }}>\uD83D\uDCCD</Text>
            <Text style={{ color: isMe ? '#fff' : '#111827', fontWeight: '700', fontSize: 13 }}>
              Shared Location
            </Text>
            {item.address ? (
              <Text style={{ color: isMe ? '#bfdbfe' : '#374151', fontSize: 12, marginTop: 2 }}>
                {item.address}
              </Text>
            ) : null}
            <Text style={{ color: isMe ? '#93c5fd' : '#6b7280', fontSize: 11, marginTop: 6 }}>
              Tap to open in Maps
            </Text>
            {sentAtLabel ? (
              <Text style={{ color: isMe ? '#bfdbfe' : '#6b7280', fontSize: 10, marginTop: 4, textAlign: isMe ? 'right' : 'left' }}>
                {sentAtLabel}
              </Text>
            ) : null}
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View
        style={{
          flexDirection: 'row',
          justifyContent: isMe ? 'flex-end' : 'flex-start',
          marginVertical: 8,
          alignItems: 'flex-end',
        }}
      >
        {!isMe && (
          <Avatar
            src={userProfile?.profilePicture}
            email={item.user}
            size={32}
            style={{ marginRight: 8 }}
          />
        )}

        <View
          style={{
            backgroundColor: isMe ? '#2563eb' : '#e5e7eb',
            padding: 10,
            borderRadius: 12,
            maxWidth: '75%',
          }}
        >
          {!isMe ? (
            <Text style={{ fontSize: 10, color: '#6b7280', marginBottom: 3 }}>
              {sender?.split('@')[0]}
            </Text>
          ) : null}
          <Text style={{ color: isMe ? 'white' : '#111827' }}>
            {item.text}
          </Text>
          {sentAtLabel ? (
            <Text style={{ color: isMe ? '#bfdbfe' : '#6b7280', fontSize: 10, marginTop: 4, textAlign: isMe ? 'right' : 'left' }}>
              {sentAtLabel}
            </Text>
          ) : null}
        </View>

        {isMe && (
          <Avatar
            src={userProfile?.profilePicture}
            email={sender}
            size={32}
            style={{ marginLeft: 8 }}
          />
        )}
      </View>
    );
  };

  return (
    <ScreenShell
      eyebrow="CONVERSATION"
      title={jobTitle || 'Chat'}
      subtitle={resolvedRequestId ? `${counterpartyName || counterpartyEmail || 'Participant'} • Request: ${resolvedRequestId}` : 'Open a request chat to talk with the other party.'}
      accentColor="#0f172a"
      accentTextColor="#bfdbfe"
    >
      <AppCard style={{ flex: 1, borderRadius: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Text style={{ color: '#1e3a8a', fontWeight: '800' }}>Secure Request Chat</Text>
          <Text style={{ color: '#64748b', fontSize: 12 }}>{messages.length} message{messages.length === 1 ? '' : 's'}</Text>
        </View>

        {(counterpartyName || counterpartyEmail) ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 12 }}>
            <Avatar src={senderProfiles[counterpartyEmail]?.profilePicture} email={counterpartyEmail || counterpartyName} size={38} style={{ marginRight: 10 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#0f172a', fontWeight: '800' }}>{counterpartyName || counterpartyEmail}</Text>
              <Text style={{ color: '#64748b', fontSize: 12 }}>Request conversation is encrypted and tied to this job.</Text>
            </View>
          </View>
        ) : null}

        <AppNotice
          tone={notice?.tone}
          title={notice?.title}
          message={notice?.message}
        />

        {isLoading ? (
          <View>
            <LoadingSkeleton height={18} width="45%" style={{ marginBottom: 12 }} />
            <LoadingSkeleton height={44} width="72%" style={{ marginBottom: 10 }} />
            <LoadingSkeleton height={44} width="56%" style={{ marginBottom: 10, alignSelf: 'flex-end' }} />
            <LoadingSkeleton height={44} width="68%" />
          </View>
        ) : messages.length === 0 ? (
          <EmptyState
            title="No messages yet"
            description="Start the conversation to coordinate this request."
          />
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item, index) => item.id || `${item.createdAt || item.timestamp || 'msg'}:${index}`}
            renderItem={({ item }) => <MessageBubble item={item} />}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
            onEndReachedThreshold={0.1}
          />
        )}

        {!isLoading && resolvedRequestId ? (
          <View style={{ marginTop: 12, marginBottom: 2 }}>
            <Text style={{ color: '#64748b', fontSize: 12, fontWeight: '700', marginBottom: 8 }}>Quick replies</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {QUICK_REPLIES.map((reply) => (
                <View key={reply} style={{ marginRight: 8, marginBottom: 8 }}>
                  <AppButton
                    label={reply}
                    variant="neutral"
                    onPress={() => setText(reply)}
                    disabled={isSending}
                    style={{ paddingHorizontal: 12, paddingVertical: 8, minHeight: 0, backgroundColor: '#eff6ff' }}
                    textStyle={{ color: '#1d4ed8', fontSize: 12, fontWeight: '700' }}
                  />
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', marginTop: 14, alignItems: 'center' }}>
          <TouchableOpacity
            onPress={handleAttachPress}
            disabled={!resolvedRequestId}
            accessibilityLabel="Attach location"
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: '#f1f5f9',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 8,
              borderWidth: 1,
              borderColor: '#e2e8f0',
            }}
          >
            <Text style={{ fontSize: 18 }}>\uD83D\uDCCE</Text>
          </TouchableOpacity>

          <AppInput
            value={text}
            onChangeText={setText}
            placeholder="Type a message..."
            containerStyle={{ flex: 1, marginBottom: 0 }}
            inputStyle={{
              flex: 1,
              borderRadius: 999,
              paddingVertical: 10,
              backgroundColor: '#f8fafc',
            }}
          />

          <AppButton
            label="Send"
            onPress={sendMessage}
            disabled={!normalizedText || !resolvedRequestId}
            loading={isSending}
            style={{ marginLeft: 8, borderRadius: 999, paddingHorizontal: 16, backgroundColor: '#1d4ed8' }}
          />
        </View>
      </AppCard>
    </ScreenShell>
  );
}
