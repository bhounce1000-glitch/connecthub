const STATUS_FLOW = ['open', 'accepted', 'working', 'done', 'confirmed', 'paid'];

const ALLOWED_TRANSITIONS = {
  open: ['accepted'],
  accepted: ['working'],
  working: ['done'],
  done: ['confirmed'],
  confirmed: ['paid'],
  paid: [],
};

const TRANSITION_RULES = {
  'open->accepted': { actor: 'provider', condition: 'job_open_and_unassigned' },
  'accepted->working': { actor: 'system', condition: 'payment_verified' },
  'working->done': { actor: 'provider', condition: 'assigned_provider_only' },
  'done->confirmed': { actor: 'customer', condition: 'job_customer_or_auto_confirm' },
  'confirmed->paid': { actor: 'system', condition: 'escrow_release' },
};

function normalizeStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'open';
  if (raw === 'in_progress') return 'working';
  if (raw === 'pending_confirmation') return 'done';
  if (raw === 'completed') return 'confirmed';
  return raw;
}

function normalizeRole(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'customer';
  if (raw === 'admin') return 'system';
  return raw;
}

function transitionKey(fromStatus, toStatus) {
  return `${normalizeStatus(fromStatus)}->${normalizeStatus(toStatus)}`;
}

function logTransitionAttempt({ jobId, userId, fromStatus, toStatus, allowed, reason = null }) {
  const payload = {
    jobId: String(jobId || ''),
    userId: String(userId || ''),
    fromStatus: normalizeStatus(fromStatus),
    toStatus: normalizeStatus(toStatus),
    timestamp: new Date().toISOString(),
    allowed: Boolean(allowed),
    reason,
  };
  console.log('[JOB_TRANSITION_ATTEMPT]', JSON.stringify(payload));
}

function canTransition(currentStatus, newStatus, userRole, meta = {}) {
  const from = normalizeStatus(currentStatus);
  const to = normalizeStatus(newStatus);
  const role = normalizeRole(userRole);
  const key = transitionKey(from, to);

  const nextAllowed = ALLOWED_TRANSITIONS[from] || [];
  const isAllowedStep = nextAllowed.includes(to);

  if (!isAllowedStep) {
    const message = `Invalid status transition: ${from} -> ${to}`;
    logTransitionAttempt({
      jobId: meta.jobId,
      userId: meta.userId,
      fromStatus: from,
      toStatus: to,
      allowed: false,
      reason: message,
    });
    throw new Error(message);
  }

  const rule = TRANSITION_RULES[key];
  if (!rule) {
    const message = `Missing transition rule for ${key}`;
    logTransitionAttempt({
      jobId: meta.jobId,
      userId: meta.userId,
      fromStatus: from,
      toStatus: to,
      allowed: false,
      reason: message,
    });
    throw new Error(message);
  }

  if (role !== rule.actor) {
    const message = `Forbidden transition ${key}: role ${role} cannot trigger this transition (required: ${rule.actor})`;
    logTransitionAttempt({
      jobId: meta.jobId,
      userId: meta.userId,
      fromStatus: from,
      toStatus: to,
      allowed: false,
      reason: message,
    });
    throw new Error(message);
  }

  logTransitionAttempt({
    jobId: meta.jobId,
    userId: meta.userId,
    fromStatus: from,
    toStatus: to,
    allowed: true,
    reason: rule.condition,
  });

  return true;
}

module.exports = {
  STATUS_FLOW,
  ALLOWED_TRANSITIONS,
  TRANSITION_RULES,
  normalizeStatus,
  normalizeRole,
  canTransition,
  logTransitionAttempt,
};
