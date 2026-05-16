import { Fragment } from 'react';
import { Text, View } from 'react-native';

import { REQUEST_STATUS } from '../../constants/access';

const STEPS = [
  { key: REQUEST_STATUS.OPEN,        short: 'Open',     color: '#d97706' },
  { key: REQUEST_STATUS.ACCEPTED,    short: 'Accepted', color: '#1d4ed8' },
  { key: REQUEST_STATUS.IN_PROGRESS, short: 'Working',  color: '#7c3aed' },
  { key: REQUEST_STATUS.PENDING_CONFIRMATION, short: 'Confirm', color: '#ca8a04' },
  { key: REQUEST_STATUS.COMPLETED,   short: 'Done',     color: '#0f766e' },
  { key: REQUEST_STATUS.PAID,        short: 'Paid',     color: '#166534' },
];

function toBoolean(value) {
  return value === true;
}

function computeStepCompletion(request) {
  const paymentReference = String(request?.paymentReference || '').trim();
  const paymentStatus = String(request?.paymentStatus || '').trim().toLowerCase();

  const openDone = true;
  const acceptedDone = Boolean(String(request?.acceptedBy || '').trim()) && Boolean(request?.acceptedAt);
  const paymentReceived = toBoolean(request?.payment_received) && toBoolean(request?.escrowFunded) && Boolean(paymentReference) && paymentStatus === 'success';
  const workingDone = paymentReceived && toBoolean(request?.work_started);
  const confirmDone = toBoolean(request?.work_completed) && Boolean(request?.completedAt);
  const doneDone = toBoolean(request?.customer_confirmed) && Boolean(request?.completionConfirmedAt);
  const paidDone = toBoolean(request?.payment_released) && toBoolean(request?.payoutCredited) && toBoolean(request?.paid) && Boolean(request?.paidAt);

  return [openDone, acceptedDone, workingDone, confirmDone, doneDone, paidDone];
}

export default function JobStepper({ request, status }) {
  const effectiveStatus = status || request?.status;
  const isDisputed = effectiveStatus === REQUEST_STATUS.DISPUTED;
  const doneMap = computeStepCompletion(request || {});
  const firstPendingIndex = doneMap.findIndex((isDone) => !isDone);
  const currentIndex = firstPendingIndex < 0 ? STEPS.length - 1 : firstPendingIndex;

  return (
    <View style={{ marginTop: 12 }}>
      {/* Dots + connecting lines */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {STEPS.map((step, index) => {
          const done = doneMap[index] === true;
          const active = !done && index === currentIndex;
          const dotColor = (done || active) ? step.color : '#d1d5db';

          return (
            <Fragment key={step.key}>
              {index > 0 && (
                <View
                  style={{
                    flex: 1,
                    height: 2,
                    backgroundColor: doneMap[index - 1] && doneMap[index] ? step.color : '#e5e7eb',
                  }}
                />
              )}

              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  backgroundColor: (done || active) ? dotColor : '#fff',
                  borderWidth: 2,
                  borderColor: dotColor,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                {done && (
                  <Text style={{ fontSize: 9, color: '#fff', fontWeight: '800' }}>✓</Text>
                )}
                {active && (
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }} />
                )}
              </View>
            </Fragment>
          );
        })}
      </View>

      {/* Labels */}
      <View style={{ flexDirection: 'row', marginTop: 5 }}>
        {STEPS.map((step, index) => {
          const done = doneMap[index] === true;
          const active = !done && index === currentIndex;
          const textColor = (done || active) ? step.color : '#94a3b8';
          const align = index === 0 ? 'flex-start' : index === STEPS.length - 1 ? 'flex-end' : 'center';

          return (
            <View key={step.key} style={{ flex: 1, alignItems: align }}>
              <Text
                style={{
                  fontSize: 9,
                  fontWeight: active ? '800' : '600',
                  color: textColor,
                }}
              >
                {step.short}
              </Text>
            </View>
          );
        })}
      </View>

      {isDisputed ? (
        <Text style={{ marginTop: 6, fontSize: 11, fontWeight: '700', color: '#b91c1c' }}>
          Disputed
        </Text>
      ) : null}
    </View>
  );
}
