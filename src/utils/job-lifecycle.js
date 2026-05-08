function normalizeRequestStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'working') return 'in_progress';
  if (raw === 'done' || raw === 'confirmed') return 'pending_confirmation';
  if (!raw) return 'open';
  return raw;
}

const REQUEST_STATUS_SEQUENCE = ['open', 'accepted', 'in_progress', 'pending_confirmation', 'completed', 'paid'];

function canAdvanceStatus(oldStatus, nextStatus) {
  const oldIndex = REQUEST_STATUS_SEQUENCE.indexOf(normalizeRequestStatus(oldStatus));
  const nextIndex = REQUEST_STATUS_SEQUENCE.indexOf(normalizeRequestStatus(nextStatus));
  if (oldIndex < 0 || nextIndex < 0) return false;
  return nextIndex >= oldIndex;
}

function shouldAutoConfirm(completedAt, nowMs = Date.now()) {
  const t = new Date(completedAt || 0).getTime();
  if (!Number.isFinite(t) || t <= 0) return false;
  return (nowMs - t) >= (48 * 60 * 60 * 1000);
}

function computeProviderPayout(price, commissionRate = 0.1, overrides = {}) {
  const gross = Number(price || 0);
  if (!Number.isFinite(gross) || gross <= 0) {
    return { gross: 0, commission: 0, providerNet: 0 };
  }

  const commission = Number.isFinite(Number(overrides.commission))
    ? Number(overrides.commission)
    : parseFloat((gross * Number(commissionRate || 0.1)).toFixed(2));

  const providerNet = Number.isFinite(Number(overrides.providerNet))
    ? Number(overrides.providerNet)
    : parseFloat((gross - commission).toFixed(2));

  return {
    gross: parseFloat(gross.toFixed(2)),
    commission: parseFloat(Math.max(0, commission).toFixed(2)),
    providerNet: parseFloat(Math.max(0, providerNet).toFixed(2)),
  };
}

function evaluateTransitionGate(fromStatus, toStatus, checks = {}, options = {}) {
  const from = normalizeRequestStatus(fromStatus);
  const to = normalizeRequestStatus(toStatus);
  const allowAutoConfirm = options.allowAutoConfirm === true;

  if (from === to) return { ok: true, reason: 'no_state_change' };
  if (from === 'open' && to === 'accepted') return { ok: true, reason: 'provider_accept_required' };
  if (from === 'accepted' && to === 'in_progress') {
    return checks.paymentReceived ? { ok: true, reason: 'payment_verified' } : { ok: false, reason: 'payment_not_verified' };
  }
  if (from === 'in_progress' && to === 'pending_confirmation') {
    return checks.workStarted ? { ok: true, reason: 'provider_marked_done' } : { ok: false, reason: 'work_not_started' };
  }
  if (from === 'pending_confirmation' && to === 'completed') {
    if (checks.workCompleted) return { ok: true, reason: 'customer_or_auto_confirmation' };
    if (allowAutoConfirm) return { ok: true, reason: 'auto_confirmation_timeout' };
    return { ok: false, reason: 'work_not_marked_completed' };
  }
  if (from === 'completed' && to === 'paid') {
    return checks.paymentReceived ? { ok: true, reason: 'escrow_release' } : { ok: false, reason: 'cannot_release_without_payment' };
  }
  return { ok: false, reason: `transition_not_allowed:${from}->${to}` };
}

module.exports = {
  normalizeRequestStatus,
  canAdvanceStatus,
  shouldAutoConfirm,
  computeProviderPayout,
  evaluateTransitionGate,
};
