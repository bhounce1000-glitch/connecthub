export function getProviderBadge(provider) {
  if (!provider) return null;
  const jobs = provider.jobsDone || provider.completedJobs || provider.jobsCompleted || 0;
  const rating = provider.avgRating || provider.rating || 0;
  const plan = provider.subscriptionPlan || 'basic';
  const kycVerified = provider.kycStatus === 'verified' || provider.kycVerified === true;

  if (plan === 'premium' && rating >= 4.5 && jobs >= 20 && kycVerified) {
    return { label: '👑 Ohene', color: '#b45309', bg: '#fef3c7', border: '#d97706' };
  }
  if ((plan === 'pro' || (rating >= 4.0 && jobs >= 10)) && kycVerified) {
    return { label: '🦅 Ɔkɔdeɛ', color: '#065f46', bg: '#d1fae5', border: '#059669' };
  }
  if (jobs >= 3 || kycVerified) {
    return { label: '⭐ Sika', color: '#1e40af', bg: '#dbeafe', border: '#3b82f6' };
  }
  if (jobs >= 1) {
    return { label: '🆕 Rising', color: '#5b21b6', bg: '#ede9fe', border: '#7c3aed' };
  }
  return { label: '👋 New', color: '#374151', bg: '#f3f4f6', border: '#d1d5db' };
}

export function getBadgeStyle(badge) {
  if (!badge) return {};
  return {
    container: {
      alignSelf: 'flex-start',
      backgroundColor: badge.bg,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: badge.border,
      paddingVertical: 2,
      paddingHorizontal: 9,
    },
    text: {
      fontSize: 10,
      fontWeight: '700',
      color: badge.color,
    },
  };
}
