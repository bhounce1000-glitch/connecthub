import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Text, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import AppInput from '../components/ui/app-input';
import AppNotice from '../components/ui/app-notice';
import Avatar from '../components/ui/avatar';
import EmptyState from '../components/ui/empty-state';
import LoadingSkeleton from '../components/ui/loading-skeleton';
import ScreenShell from '../components/ui/screen-shell';

// Firebase
import { addDoc, collection, doc, getDoc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { auth, db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';

export default function Chat() {
  const router = useRouter();
  const { requestId } = useLocalSearchParams();
  const { user, isAuthReady } = useAuthUser();
  const resolvedRequestId = Array.isArray(requestId) ? requestId[0] : requestId;
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
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
          requestParticipants.current = {
            user: data.user || null,
            acceptedBy: data.acceptedBy || null,
          };
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
        const data = snapshot.docs.map((doc) => doc.data());
        setMessages(data);
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
  }, [resolvedRequestId]);

  useEffect(() => {
    const loadSenderProfiles = async () => {
      const uniqueUsers = [...new Set(messages.map((message) => message.user).filter(Boolean))];
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
      } catch (error) {
        // Non-blocking: chat still renders with initials when profile docs are missing.
        console.log('Unable to load sender profiles:', error?.message || error);
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
        text: normalizedText,
        user: auth.currentUser?.email,
        createdAt: new Date(),
      });

      // Notify the other participant that a new message arrived
      const senderEmail = auth.currentUser?.email;
      const { user: requestOwner, acceptedBy: provider } = requestParticipants.current;
      const recipient = senderEmail === requestOwner ? provider : requestOwner;
      if (recipient && recipient !== senderEmail) {
        addDoc(collection(db, 'notifications'), {
          user: recipient,
          text: `New message from ${senderEmail?.split('@')[0]} on request ${resolvedRequestId}.`,
          read: false,
          createdAt: new Date().toISOString(),
        }).catch(() => {/* non-blocking */});
      }
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

  const MessageBubble = ({ item }) => {
    const isMe = item.user === auth.currentUser?.email;
    const userProfile = senderProfiles[item.user];

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
              {item.user?.split('@')[0]}
            </Text>
          ) : null}
          <Text style={{ color: isMe ? 'white' : '#111827' }}>
            {item.text}
          </Text>
        </View>

        {isMe && (
          <Avatar
            src={userProfile?.profilePicture}
            email={item.user}
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
      title="Chat"
      subtitle={resolvedRequestId ? `Request: ${resolvedRequestId}` : 'Open a request chat to talk with the other party.'}
      accentColor="#1d4ed8"
      accentTextColor="#dbeafe"
    >
      <AppCard style={{ flex: 1 }}>
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
            keyExtractor={(_, index) => index.toString()}
            renderItem={({ item }) => <MessageBubble item={item} />}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
            onEndReachedThreshold={0.1}
          />
        )}

        <View style={{ flexDirection: 'row', marginTop: 14 }}>
          <AppInput
            value={text}
            onChangeText={setText}
            placeholder="Type a message..."
            containerStyle={{ flex: 1, marginBottom: 0 }}
            inputStyle={{
              flex: 1,
              borderRadius: 20,
              paddingVertical: 10,
            }}
          />

          <AppButton
            label="Send"
            onPress={sendMessage}
            disabled={!normalizedText || !resolvedRequestId}
            loading={isSending}
            style={{ marginLeft: 8, borderRadius: 20, paddingHorizontal: 16 }}
          />
        </View>
      </AppCard>
    </ScreenShell>
  );
}
