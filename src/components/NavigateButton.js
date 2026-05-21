import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { calculateDistance, estimateTravelTime, formatDistance, openBestNavigation } from '../utils/location';

export default function NavigateButton({ destLat, destLon, destLabel = 'Job Location', providerLat, providerLon, size = 'large', style }) {
  const hasCoords = Number.isFinite(Number(destLat)) && Number.isFinite(Number(destLon));
  const hasProviderCoords = Number.isFinite(Number(providerLat)) && Number.isFinite(Number(providerLon));

  let distanceText = null;
  let etaText = null;

  if (hasCoords && hasProviderCoords) {
    const km = calculateDistance(Number(providerLat), Number(providerLon), Number(destLat), Number(destLon));
    distanceText = formatDistance(km);
    etaText = estimateTravelTime(km);
  }

  const handlePress = () => {
    openBestNavigation(Number(destLat), Number(destLon), destLabel);
  };

  if (size === 'compact') {
    return (
      <TouchableOpacity style={[styles.compactButton, !hasCoords && styles.disabledButton, style]} onPress={handlePress} disabled={!hasCoords} activeOpacity={0.8}>
        <Text style={styles.compactIcon}>🗺️</Text>
        <Text style={[styles.compactText, !hasCoords && styles.disabledText]}>{hasCoords ? 'Navigate' : 'No GPS'}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.container, style]}>
      {distanceText && etaText ? (
        <View style={styles.infoRow}>
          <View style={styles.infoChip}><Text style={styles.infoText}>📍 {distanceText}</Text></View>
          <View style={styles.infoChip}><Text style={styles.infoText}>⏱️ {etaText}</Text></View>
        </View>
      ) : null}

      <TouchableOpacity style={[styles.navButton, !hasCoords && styles.disabledButton]} onPress={handlePress} disabled={!hasCoords} activeOpacity={0.8}>
        <Text style={styles.navIcon}>🗺️</Text>
        <View>
          <Text style={styles.navButtonText}>{hasCoords ? 'Open Navigation' : 'Location Not Available'}</Text>
          {hasCoords ? <Text style={styles.navButtonSub}>Opens Google Maps or Apple Maps with turn-by-turn directions</Text> : null}
        </View>
      </TouchableOpacity>

      {!hasCoords ? <Text style={styles.noGpsHint}>ℹ️ This job only has a text address. Contact the customer for exact directions.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  infoRow: { flexDirection: 'row', gap: 8 },
  infoChip: { backgroundColor: '#eff6ff', borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12 },
  infoText: { fontSize: 13, color: '#1d4ed8', fontWeight: '600' },
  navButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1d4ed8', borderRadius: 12, paddingVertical: 16, paddingHorizontal: 20, gap: 14, minHeight: 64 },
  navIcon: { fontSize: 28 },
  navButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  navButtonSub: { color: '#bfdbfe', fontSize: 12, marginTop: 2 },
  disabledButton: { backgroundColor: '#e2e8f0' },
  disabledText: { color: '#94a3b8' },
  noGpsHint: { fontSize: 12, color: '#d97706', backgroundColor: '#fef3c7', borderRadius: 8, padding: 10 },
  compactButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1d4ed8', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, gap: 6 },
  compactIcon: { fontSize: 16 },
  compactText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
