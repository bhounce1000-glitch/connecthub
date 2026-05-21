import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import AppButton from '../components/ui/app-button';
import AppCard from '../components/ui/app-card';
import Avatar from '../components/ui/avatar';
import LoadingSkeleton from '../components/ui/loading-skeleton';
import SubscriptionBadge from '../components/ui/subscription-badge';
import { AppColors, AppRadius, AppSpace, AppType } from '../constants/design-tokens';

// Firebase
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { API_BASE_URL } from '../constants/api';
import { db } from '../firebase';
import useAuthUser from '../hooks/use-auth-user';
import { apiPost, assertApiSuccess } from '../utils/api-client';
import { getCurrentLocation } from '../utils/location';

function StatBox({ label, value }) {
  return (
    <View style={{
      flex: 1,
      backgroundColor: '#f8fafc',
      borderRadius: AppRadius.md,
      padding: 12,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: '#e2e8f0',
    }}>
      <Text style={{ fontSize: 22, fontWeight: '800', color: AppColors.ink900 }}>{value}</Text>
      <Text style={{ fontSize: 12, color: AppColors.ink500, marginTop: 3, textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

function Badge({ label, color = '#e0e7ff', textColor = '#3730a3' }) {
  return (
    <View style={{ backgroundColor: color, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, marginRight: 6, marginBottom: 6 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: textColor }}>{label}</Text>
    </View>
  );
}

function HighlightPill({ label, value }) {
  return (
    <View style={{ backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, marginRight: 8, marginBottom: 8 }}>
      <Text style={{ color: '#c7d2fe', fontSize: 11, fontWeight: '700' }}>{label}</Text>
      <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '900', marginTop: 2 }}>{value}</Text>
    </View>
  );
}

function StarRow({ value }) {
  if (!value) return null;
  const n = Math.min(5, Math.max(1, Number(value)));
  return (
    <Text style={{ color: '#d97706', fontSize: 15, letterSpacing: 1 }}>
      {'★'.repeat(n)}{'☆'.repeat(5 - n)}
    </Text>
  );
}

function VoteButton({ emoji, count, active, disabled, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 5,
        paddingHorizontal: 10,
        borderRadius: AppRadius.sm,
        borderWidth: 1.5,
        borderColor: active ? '#4f46e5' : '#e2e8f0',
        backgroundColor: active ? '#eef2ff' : '#f8fafc',
        marginRight: 8,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Text style={{ fontSize: 15 }}>{emoji}</Text>
      <Text style={{ fontSize: 13, fontWeight: '700', color: active ? '#4f46e5' : AppColors.ink500, marginLeft: 4 }}>
        {count}
      </Text>
    </TouchableOpacity>
  );
}

function ReviewCard({ review, myVote, onVote, isVoting, profiles }) {
  const rawDate = review.ratedAt || review.completedAt || review.paidAt;
  let formattedDate = '';
  if (rawDate) {
    try {
      const d = typeof rawDate === 'string' ? new Date(rawDate) : rawDate.toDate?.();
      if (d && !Number.isNaN(d.getTime())) formattedDate = d.toLocaleDateString();
    } catch {}
  }

  const profile = review.user ? profiles[review.user] : null;
  const displayName = profile?.name || review.user || 'Customer';

  return (
    <View style={{
      borderTopWidth: 1,
      borderTopColor: '#e2e8f0',
      paddingTop: 14,
      marginTop: 14,
    }}>
      {/* Reviewer identity + date */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <Avatar src={profile?.profilePicture || null} email={review.user} size={34} />
        <View style={{ marginLeft: 10, flex: 1 }}>
          <Text style={{ fontWeight: '700', color: AppColors.ink900, fontSize: 14 }}>{displayName}</Text>
          <StarRow value={review.rating} />
        </View>
        {formattedDate ? (
          <Text style={{ fontSize: 11, color: AppColors.ink500 }}>{formattedDate}</Text>
        ) : null}
      </View>

      {/* Review text */}
      {review.review ? (
        <Text style={{ color: AppColors.ink700, fontSize: 14, lineHeight: 20, marginBottom: 10 }}>
          {review.review}
        </Text>
      ) : null}

      {/* Like / Dislike */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <VoteButton
          emoji="👍"
          count={review.providerReviewLikes || 0}
          active={myVote === 'like'}
          disabled={isVoting}
          onPress={() => onVote(review.id, 'like')}
        />
        <VoteButton
          emoji="👎"
          count={review.providerReviewDislikes || 0}
          active={myVote === 'dislike'}
          disabled={isVoting}
          onPress={() => onVote(review.id, 'dislike')}
        />
        {isVoting && (
          <Text style={{ fontSize: 12, color: AppColors.ink500, marginLeft: 4 }}>Saving…</Text>
        )}
      </View>
    </View>
  );
}

export default function ProviderDetail() {
  const router = useRouter();
  const { email } = useLocalSearchParams();
  const { user, isAuthReady } = useAuthUser();

  const [provider, setProvider] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [reviews, setReviews] = useState([]);
  const [liveStats, setLiveStats] = useState({ jobs: null, avgRating: null });
  const [reviewerProfiles, setReviewerProfiles] = useState({});
  const [myVotes, setMyVotes] = useState({});   // requestId -> 'like'|'dislike'
  const [votingId, setVotingId] = useState(null);
  const [myLocation, setMyLocation] = useState(null);

  useEffect(() => {
    getCurrentLocation()
      .then((loc) => { if (loc) setMyLocation(loc); })
      .catch(() => {});
  }, []);

  const currentEmail = user?.email || '';

  useEffect(() => {
    if (isAuthReady && !user) {
      router.replace('/auth');
    }
  }, [isAuthReady, router, user]);

  useEffect(() => {
    if (!email) return;

    const load = async () => {
      try {
        const providerEmail = Array.isArray(email) ? email[0] : email;
        const [providerSnap, userSnap] = await Promise.all([
          getDoc(doc(db, 'providers', providerEmail)),
          getDoc(doc(db, 'users', providerEmail)),
        ]);
        if (providerSnap.exists()) {
          const providerData = providerSnap.data() || {};
          const userData = userSnap.exists() ? (userSnap.data() || {}) : {};
          setProvider({
            id: providerSnap.id,
            ...providerData,
            subscriptionPlan: userData.subscriptionPlan || providerData.subscriptionPlan || 'free',
          });
        } else {
          setNotFound(true);
        }
      } catch {
        setNotFound(true);
      } finally {
        setIsLoading(false);
      }

      // Fetch all requests for this provider to compute live stats and reviews
      try {
        const providerEmail = Array.isArray(email) ? email[0] : email;
        const reqSnap = await getDocs(
          query(collection(db, 'requests'), where('acceptedBy', '==', providerEmail))
        );

        let totalJobs = 0;
        let ratingSum = 0;
        let ratingCount = 0;
        const reviewDocs = [];

        reqSnap.docs.forEach((d) => {
          const data = d.data();
          if (data.paid || data.status === 'completed') totalJobs++;
          if (data.rating) {
            ratingSum += data.rating;
            ratingCount++;
            reviewDocs.push({ id: d.id, ...data });
          }
        });

        reviewDocs.sort((a, b) => {
          const ts = (r) => r.ratedAt || r.paidAt || r.completedAt || '';
          return String(ts(b)).localeCompare(String(ts(a)));
        });

        setLiveStats({
          jobs: totalJobs,
          avgRating: ratingCount ? (ratingSum / ratingCount).toFixed(1) : null,
        });
        setReviews(reviewDocs);

        // Batch-fetch reviewer profile pictures
        const customerEmails = new Set(reviewDocs.map((r) => r.user).filter(Boolean));
        const profileMap = {};
        await Promise.all([...customerEmails].map(async (e) => {
          try {
            const [uSnap, pSnap] = await Promise.all([
              getDoc(doc(db, 'users', e)),
              getDoc(doc(db, 'providers', e)),
            ]);
            profileMap[e] = {
              name: pSnap.data()?.name || uSnap.data()?.name || null,
              profilePicture: uSnap.data()?.profilePicture || pSnap.data()?.profilePicture || null,
            };
          } catch {}
        }));
        setReviewerProfiles(profileMap);

        // Fetch current user's votes for each review (doc IDs are deterministic)
        if (currentEmail) {
          const sanitized = currentEmail.replace(/[@.]/g, '_');
          const voteDocs = await Promise.all(
            reviewDocs.map((r) => getDoc(doc(db, 'reviewVotes', `${r.id}_provider_${sanitized}`)))
          );
          const voteMap = {};
          voteDocs.forEach((vSnap, i) => {
            if (vSnap.exists()) voteMap[reviewDocs[i].id] = vSnap.data().vote;
          });
          setMyVotes(voteMap);
        }
      } catch {}
    };

    load();
  }, [email, currentEmail]);

  const handleVote = async (requestId, vote) => {
    if (!currentEmail || votingId) return;
    const prev = myVotes[requestId];
    if (prev === vote) return; // already voted same way

    // Optimistic update
    setVotingId(requestId);
    setMyVotes((m) => ({ ...m, [requestId]: vote }));
    setReviews((rs) => rs.map((r) => {
      if (r.id !== requestId) return r;
      const likeDelta   = vote === 'like'    ? 1 : (prev === 'like'    ? -1 : 0);
      const dislikeDelta = vote === 'dislike' ? 1 : (prev === 'dislike' ? -1 : 0);
      return {
        ...r,
        providerReviewLikes:    Math.max(0, (r.providerReviewLikes    || 0) + likeDelta),
        providerReviewDislikes: Math.max(0, (r.providerReviewDislikes || 0) + dislikeDelta),
      };
    }));

    try {
      const { response, data } = await apiPost(
        API_BASE_URL + '/reviews/' + requestId + '/vote',
        { side: 'provider', vote },
        { requireAuth: true }
      );
      assertApiSuccess(response, data, 'Could not record vote');
    } catch {
      // Revert optimistic update on failure
      setMyVotes((m) => ({ ...m, [requestId]: prev || undefined }));
      setReviews((rs) => rs.map((r) => {
        if (r.id !== requestId) return r;
        const likeDelta    = vote === 'like'    ? -1 : (prev === 'like'    ? 1 : 0);
        const dislikeDelta = vote === 'dislike' ? -1 : (prev === 'dislike' ? 1 : 0);
        return {
          ...r,
          providerReviewLikes:    Math.max(0, (r.providerReviewLikes    || 0) + likeDelta),
          providerReviewDislikes: Math.max(0, (r.providerReviewDislikes || 0) + dislikeDelta),
        };
      }));
    } finally {
      setVotingId(null);
    }
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#eef2ff', padding: AppSpace.lg }}>
        <View style={{ backgroundColor: '#4f46e5', borderRadius: AppRadius.xl, padding: AppSpace.lg, marginBottom: AppSpace.lg }}>
          <LoadingSkeleton height={14} width="25%" style={{ marginBottom: 8 }} />
          <LoadingSkeleton height={34} width="60%" />
        </View>
        <AppCard style={{ marginBottom: AppSpace.md }}>
          <LoadingSkeleton height={80} width={80} style={{ borderRadius: 40, marginBottom: 12 }} />
          <LoadingSkeleton height={20} width="50%" style={{ marginBottom: 8 }} />
          <LoadingSkeleton height={14} width="70%" style={{ marginBottom: 6 }} />
          <LoadingSkeleton height={14} width="60%" />
        </AppCard>
      </View>
    );
  }

  if (notFound || !provider) {
    return (
      <View style={{ flex: 1, backgroundColor: '#eef2ff', padding: AppSpace.lg, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: AppColors.ink900, marginBottom: 8 }}>Provider not found</Text>
        <Text style={{ color: AppColors.ink500, marginBottom: 20, textAlign: 'center' }}>
          This provider profile may have been removed or made unavailable.
        </Text>
        <AppButton label="← Browse Providers" variant="neutral" onPress={() => router.back()} />
      </View>
    );
  }

  const rating = liveStats.avgRating ?? (provider.avgRating ? Number(provider.avgRating).toFixed(1) : null);
  const jobs = liveStats.jobs ?? provider.jobsCompleted ?? 0;
  const portfolioPhotos = Array.isArray(provider.portfolioPhotos) ? provider.portfolioPhotos.filter(Boolean).slice(0, 6) : [];
  const serviceHighlights = [
    provider.category ? `Specializes in ${provider.category}` : null,
    provider.location ? `Covers ${provider.location}` : null,
    provider.experience ? `${provider.experience}+ years experience` : null,
    provider.startingPrice ? `Starts from GHS ${provider.startingPrice}` : null,
  ].filter(Boolean);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#eef2ff' }}>
      <View style={{ padding: AppSpace.lg }}>
        {/* Header banner */}
        <View style={{ backgroundColor: '#4f46e5', borderRadius: AppRadius.xl, padding: AppSpace.lg, marginBottom: AppSpace.lg }}>
          <Text style={{ fontSize: AppType.overline, color: '#c7d2fe', fontWeight: '700', letterSpacing: 0.4, fontFamily: 'serif' }}>
            PROVIDER PROFILE
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 8 }}>
            <Text style={{ fontSize: AppType.heading, fontWeight: '800', color: AppColors.white, flexShrink: 1 }} numberOfLines={2}>
              {provider.name || provider.email}
            </Text>
            <SubscriptionBadge plan={provider.subscriptionPlan} />
          </View>
          {provider.category ? (
            <Text style={{ color: '#c7d2fe', marginTop: 6, fontWeight: '600' }}>{provider.category}</Text>
          ) : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 }}>
            <HighlightPill label="Response" value={provider.isAvailable ? 'Available now' : 'Offline'} />
            <HighlightPill label="Completed" value={String(jobs)} />
            <HighlightPill label="Rating" value={rating ? `${rating} / 5` : 'New'} />
          </View>
        </View>

        {/* Identity card */}
        <AppCard style={{ marginBottom: AppSpace.md, alignItems: 'center', paddingVertical: 24 }}>
          <Avatar src={provider.profilePicture} email={provider.email} size={80} />
          <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 20, fontWeight: '800', color: AppColors.ink900 }}>
              {provider.name || provider.email}
            </Text>
            <SubscriptionBadge plan={provider.subscriptionPlan} />
          </View>
          <Text style={{ fontSize: 14, color: AppColors.ink500, marginTop: 4 }}>{provider.email}</Text>

          <View style={{ flexDirection: 'row', marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            {provider.isAvailable ? (
              <Badge label="✓ AVAILABLE NOW" color="#d1fae5" textColor="#065f46" />
            ) : (
              <Badge label="UNAVAILABLE" color="#fee2e2" textColor="#991b1b" />
            )}
            {provider.category ? (
              <Badge label={provider.category} />
            ) : null}
          </View>
        </AppCard>

        {/* Stats row */}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: AppSpace.md }}>
          <StatBox label="Rating" value={rating ? `⭐ ${rating}` : 'New'} />
          <StatBox label="Jobs Done" value={jobs} />
          {provider.experience ? (
            <StatBox label="Experience" value={`${provider.experience} yrs`} />
          ) : null}
        </View>

        {/* About */}
        {provider.bio ? (
          <AppCard style={{ marginBottom: AppSpace.md }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: AppColors.ink500, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              About
            </Text>
            <Text style={{ color: AppColors.ink700, lineHeight: 22 }}>{provider.bio}</Text>
          </AppCard>
        ) : null}

        {serviceHighlights.length > 0 ? (
          <AppCard style={{ marginBottom: AppSpace.md }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: AppColors.ink500, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Why clients hire this provider
            </Text>
            {serviceHighlights.map((item) => (
              <View key={item} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ color: '#16a34a', fontSize: 14, marginRight: 8 }}>●</Text>
                <Text style={{ color: AppColors.ink700, lineHeight: 20, flex: 1 }}>{item}</Text>
              </View>
            ))}
          </AppCard>
        ) : null}

        {/* Details */}
        <AppCard style={{ marginBottom: AppSpace.md }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: AppColors.ink500, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Details
          </Text>

          {provider.location ? (
            <View style={{ flexDirection: 'row', marginBottom: 10 }}>
              <Text style={{ width: 28, fontSize: 16 }}>📍</Text>
              <View>
                <Text style={{ fontSize: 12, color: AppColors.ink500 }}>Service Area</Text>
                <Text style={{ fontWeight: '600', color: AppColors.ink900 }}>{provider.location}</Text>
              </View>
            </View>
          ) : null}

          {provider.startingPrice ? (
            <View style={{ flexDirection: 'row', marginBottom: 10 }}>
              <Text style={{ width: 28, fontSize: 16 }}>💰</Text>
              <View>
                <Text style={{ fontSize: 12, color: AppColors.ink500 }}>Starting Price</Text>
                <Text style={{ fontWeight: '600', color: AppColors.ink900 }}>GHS {provider.startingPrice}</Text>
              </View>
            </View>
          ) : null}

          {provider.phone ? (
            <View style={{ flexDirection: 'row', marginBottom: 10 }}>
              <Text style={{ width: 28, fontSize: 16 }}>📞</Text>
              <View>
                <Text style={{ fontSize: 12, color: AppColors.ink500 }}>Phone</Text>
                <Text style={{ fontWeight: '600', color: AppColors.ink900 }}>{provider.phone}</Text>
              </View>
            </View>
          ) : null}

          {provider.experience ? (
            <View style={{ flexDirection: 'row' }}>
              <Text style={{ width: 28, fontSize: 16 }}>🏆</Text>
              <View>
                <Text style={{ fontSize: 12, color: AppColors.ink500 }}>Experience</Text>
                <Text style={{ fontWeight: '600', color: AppColors.ink900 }}>{provider.experience} year{Number(provider.experience) !== 1 ? 's' : ''}</Text>
              </View>
            </View>
          ) : null}
        </AppCard>

        {/* Service area with navigation */}
        {Number.isFinite(Number(provider?.latitude)) && Number.isFinite(Number(provider?.longitude)) ? (
          <AppCard style={{ marginBottom: AppSpace.md }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: AppColors.ink500, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              📍 Service Area
            </Text>
            {provider.locationArea ? (
              <Text style={{ color: AppColors.ink700, marginBottom: 8 }}>
                Based in: <Text style={{ fontWeight: '700' }}>{provider.locationArea}</Text>
              </Text>
            ) : null}
            {myLocation ? (
              <Text style={{ color: AppColors.ink500, fontSize: 13, marginBottom: 8 }}>
                Distance from you:{' '}
                <Text style={{ fontWeight: '700', color: '#1d4ed8' }}>
                  {formatDistance(
                    calculateDistance(
                      myLocation.latitude,
                      myLocation.longitude,
                      Number(provider.latitude),
                      Number(provider.longitude)
                    )
                  )}
                </Text>
              </Text>
            ) : null}
            <NavigateButton
              destLat={Number(provider.latitude)}
              destLon={Number(provider.longitude)}
              destLabel={provider.name || provider.email}
              providerLat={myLocation?.latitude}
              providerLon={myLocation?.longitude}
            />
          </AppCard>
        ) : null}

        {portfolioPhotos.length > 0 ? (
          <AppCard style={{ marginBottom: AppSpace.md }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: AppColors.ink500, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Portfolio Preview
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {portfolioPhotos.map((photo) => (
                <Image
                  key={photo}
                  source={{ uri: photo }}
                  style={{ width: 180, height: 132, borderRadius: 14, marginRight: 10, backgroundColor: '#e2e8f0' }}
                  resizeMode="cover"
                />
              ))}
            </ScrollView>
          </AppCard>
        ) : null}

        {/* Reviews */}
        {reviews.length > 0 && (
          <AppCard style={{ marginBottom: AppSpace.md }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: AppColors.ink500, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Reviews ({reviews.length})
            </Text>
            {reviews.map((review) => (
              <ReviewCard
                key={review.id}
                review={review}
                myVote={myVotes[review.id]}
                onVote={handleVote}
                isVoting={votingId === review.id}
                profiles={reviewerProfiles}
              />
            ))}
          </AppCard>
        )}

        {/* Action buttons */}
        <AppButton
          label="Post a Request"
          variant="primary"
          onPress={() => router.push('/request')}
          style={{ marginBottom: AppSpace.sm, backgroundColor: '#4f46e5' }}
        />
        <Text style={{ fontSize: 13, color: AppColors.ink500, textAlign: 'center', marginBottom: AppSpace.md, lineHeight: 18 }}>
          Post your request on the board — providers like this one can see it and accept it. You can also chat to negotiate the price.
        </Text>

        <AppButton
          label="← Back to Providers"
          variant="neutral"
          onPress={() => router.back()}
          style={{ marginBottom: AppSpace.lg }}
        />
      </View>
    </ScrollView>
  );
}
