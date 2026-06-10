export function getProviderBadge(provider) {
  if (!provider) return null
  const jobs = Number(provider.jobsDone || provider.completedJobs || 0)
  const rating = Number(provider.avgRating || provider.rating || 0)
  const plan = String(provider.subscriptionPlan || 'basic').toLowerCase()
  const kycVerified = provider.kycStatus === 'verified'

  if (plan === 'premium' && rating >= 4.5 && jobs >= 20 && kycVerified)
    return { label: '👑 Ohene', color: '#92400e', bg: '#fef3c7', border: '#d97706' }
  if ((plan === 'pro' || (rating >= 4.0 && jobs >= 10)) && kycVerified)
    return { label: '🦅 Ɔkɔdeɛ', color: '#064e3b', bg: '#d1fae5', border: '#059669' }
  if (kycVerified || jobs >= 3)
    return { label: '✨ Sika', color: '#1e40af', bg: '#dbeafe', border: '#3b82f6' }
  if (jobs >= 1)
    return { label: '🚀 Rising', color: '#5b21b6', bg: '#ede9fe', border: '#7c3aed' }
  return { label: '👋 New', color: '#374151', bg: '#f9fafb', border: '#d1d5db' }
}

export function getBadgeStyle(badge) {
  if (!badge) return null
  return {
    container: { alignSelf: 'flex-start', backgroundColor: badge.bg, borderRadius: 20, borderWidth: 1, borderColor: badge.border, paddingVertical: 2, paddingHorizontal: 8 },
    text: { fontSize: 10, fontWeight: '800', color: badge.color },
  }
}
