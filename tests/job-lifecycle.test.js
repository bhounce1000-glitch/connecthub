const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeRequestStatus,
  canAdvanceStatus,
  shouldAutoConfirm,
  computeProviderPayout,
  evaluateTransitionGate,
} = require('../src/utils/job-lifecycle');

test('normalizeRequestStatus maps aliases correctly', () => {
  assert.equal(normalizeRequestStatus('working'), 'in_progress');
  assert.equal(normalizeRequestStatus('done'), 'pending_confirmation');
  assert.equal(normalizeRequestStatus('confirmed'), 'pending_confirmation');
  assert.equal(normalizeRequestStatus(''), 'open');
});

test('canAdvanceStatus enforces one-way state progression', () => {
  assert.equal(canAdvanceStatus('open', 'accepted'), true);
  assert.equal(canAdvanceStatus('accepted', 'in_progress'), true);
  assert.equal(canAdvanceStatus('paid', 'completed'), false);
  assert.equal(canAdvanceStatus('pending_confirmation', 'accepted'), false);
});

test('shouldAutoConfirm triggers only after 48 hours', () => {
  const now = Date.now();
  const fortySevenHoursAgo = new Date(now - (47 * 60 * 60 * 1000)).toISOString();
  const fortyNineHoursAgo = new Date(now - (49 * 60 * 60 * 1000)).toISOString();

  assert.equal(shouldAutoConfirm(fortySevenHoursAgo, now), false);
  assert.equal(shouldAutoConfirm(fortyNineHoursAgo, now), true);
  assert.equal(shouldAutoConfirm(null, now), false);
});

test('computeProviderPayout calculates commission and net payout', () => {
  const result = computeProviderPayout(200, 0.1);
  assert.deepEqual(result, {
    gross: 200,
    commission: 20,
    providerNet: 180,
  });

  const overridden = computeProviderPayout(200, 0.1, { providerNet: 150, commission: 50 });
  assert.deepEqual(overridden, {
    gross: 200,
    commission: 50,
    providerNet: 150,
  });
});

test('evaluateTransitionGate blocks accepted -> in_progress without payment proof', () => {
  const blocked = evaluateTransitionGate('accepted', 'in_progress', { paymentReceived: false });
  assert.equal(blocked.ok, false);

  const allowed = evaluateTransitionGate('accepted', 'in_progress', { paymentReceived: true });
  assert.equal(allowed.ok, true);
});

test('evaluateTransitionGate blocks in_progress -> pending_confirmation unless work started', () => {
  assert.equal(evaluateTransitionGate('in_progress', 'pending_confirmation', { workStarted: false }).ok, false);
  assert.equal(evaluateTransitionGate('in_progress', 'pending_confirmation', { workStarted: true }).ok, true);
});

test('evaluateTransitionGate supports 48h auto confirm override', () => {
  assert.equal(
    evaluateTransitionGate('pending_confirmation', 'completed', { workCompleted: false }, { allowAutoConfirm: false }).ok,
    false
  );
  assert.equal(
    evaluateTransitionGate('pending_confirmation', 'completed', { workCompleted: false }, { allowAutoConfirm: true }).ok,
    true
  );
});
