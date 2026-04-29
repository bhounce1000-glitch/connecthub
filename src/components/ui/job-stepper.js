import { Fragment } from 'react';
import { Text, View } from 'react-native';

import { REQUEST_STATUS } from '../../constants/access';

const STEPS = [
  { key: REQUEST_STATUS.OPEN,        short: 'Open',     color: '#d97706' },
  { key: REQUEST_STATUS.ACCEPTED,    short: 'Accepted', color: '#1d4ed8' },
  { key: REQUEST_STATUS.IN_PROGRESS, short: 'Working',  color: '#7c3aed' },
  { key: REQUEST_STATUS.COMPLETED,   short: 'Done',     color: '#0f766e' },
  { key: REQUEST_STATUS.PAID,        short: 'Paid',     color: '#166534' },
];

export default function JobStepper({ status }) {
  const currentIndex = STEPS.findIndex((s) => s.key === status);
  const safeIndex = currentIndex < 0 ? 0 : currentIndex;

  return (
    <View style={{ marginTop: 12 }}>
      {/* Dots + connecting lines */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {STEPS.map((step, index) => {
          const past = index < safeIndex;
          const active = index === safeIndex;
          const dotColor = (past || active) ? step.color : '#d1d5db';

          return (
            <Fragment key={step.key}>
              {index > 0 && (
                <View
                  style={{
                    flex: 1,
                    height: 2,
                    backgroundColor: index <= safeIndex ? step.color : '#e5e7eb',
                  }}
                />
              )}

              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  backgroundColor: (past || active) ? dotColor : '#fff',
                  borderWidth: 2,
                  borderColor: dotColor,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                {past && (
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
          const past = index < safeIndex;
          const active = index === safeIndex;
          const textColor = (past || active) ? step.color : '#94a3b8';
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
    </View>
  );
}
