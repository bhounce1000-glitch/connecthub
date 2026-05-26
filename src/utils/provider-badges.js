/**
 * Returns a badge object for a provider based on their performance metrics.
 * @param {object} provider - Provider data object
 * @returns {{ label: string, color: string, bg: string } | null}
 */
export function getProviderBadge(provider) {
  if (!provider) return null
  const jobs = provider.jobsDone || provider.jobsCompleted || 0
  const rating = provider.avgRating || 0
  const plan = provider.subscriptionPlan || 'basic'

  if (plan === 'premium' && rating >= 4.5 && jobs >= 20) {
    return { label: '👑 Elite', color: '#d97706', bg: '#fef3c7' }
  }
  if (plan === 'pro' || (rating >= 4.0 && jobs >= 10)) {
    return { label: '✅ Trusted', color: '#059669', bg: '#d1fae5' }
  }
  if (jobs >= 5) {
    return { label: '⭐ Experienced', color: '#1d4ed8', bg: '#dbeafe' }
  }
  if (jobs >= 1) {
    return { label: '🆕 Rising', color: '#7c3aed', bg: '#ede9fe' }
  }
  return { label: '👋 New', color: '#64748b', bg: '#f1f5f9' }
}
