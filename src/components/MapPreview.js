import { Image, Text, TouchableOpacity, View } from 'react-native';

import { openBestNavigation } from '../utils/location';

export default function MapPreview({ latitude, longitude, label = 'Job Location', customerName, providerLat, providerLon, height = 180, showNavigateButton = true }) {
  const hasCoords = Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

  const getStaticMapUrl = () => {
    if (!hasCoords || !apiKey) return null;
    const markers = [`color:red|label:J|${latitude},${longitude}`];
    if (Number.isFinite(Number(providerLat)) && Number.isFinite(Number(providerLon))) {
      markers.push(`color:blue|label:P|${providerLat},${providerLon}`);
    }
    const markersParam = markers.map((m) => `markers=${encodeURIComponent(m)}`).join('&');
    return `https://maps.googleapis.com/maps/api/staticmap?center=${latitude},${longitude}&zoom=15&size=600x300&maptype=roadmap&${markersParam}&key=${apiKey}`;
  };

  const mapUrl = getStaticMapUrl();

  if (!hasCoords) {
    return (
      <View style={{ backgroundColor: '#f8fafc', borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20, height }}>
        <Text style={{ fontSize: 36 }}>📍</Text>
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#64748b' }}>Text Address Only</Text>
        <Text style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', lineHeight: 18 }}>GPS coordinates not available for this job. Ask the customer to share their live location.</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      {mapUrl ? (
        <TouchableOpacity onPress={() => openBestNavigation(Number(latitude), Number(longitude), label)} activeOpacity={0.9}>
          <View style={{ borderRadius: 14, overflow: 'hidden', backgroundColor: '#e2e8f0', height }}>
            <Image source={{ uri: mapUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            <View style={{ position: 'absolute', bottom: 10, right: 10 }}>
              <View style={{ backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 20, paddingVertical: 6, paddingHorizontal: 14 }}>
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>🗺️ Tap to Navigate</Text>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={{ backgroundColor: '#eff6ff', borderRadius: 14, borderWidth: 2, borderColor: '#bfdbfe', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20, height }} onPress={() => openBestNavigation(Number(latitude), Number(longitude), label)} activeOpacity={0.8}>
          <Text style={{ fontSize: 36 }}>📍</Text>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#1e3a8a' }}>{label}</Text>
          <Text style={{ fontSize: 12, color: '#64748b' }}>{Number(latitude).toFixed(4)}, {Number(longitude).toFixed(4)}</Text>
          <View style={{ backgroundColor: '#1d4ed8', borderRadius: 20, paddingVertical: 6, paddingHorizontal: 16, marginTop: 4 }}>
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Tap to open navigation →</Text>
          </View>
        </TouchableOpacity>
      )}

      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 14 }}>📍</Text>
          <Text style={{ fontSize: 13, color: '#334155', fontWeight: '500' }}>{label}</Text>
        </View>
        {customerName ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 14 }}>👤</Text>
            <Text style={{ fontSize: 13, color: '#334155', fontWeight: '500' }}>{customerName}</Text>
          </View>
        ) : null}
      </View>

      {showNavigateButton ? (
        <TouchableOpacity style={{ backgroundColor: '#1d4ed8', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }} onPress={() => openBestNavigation(Number(latitude), Number(longitude), label)} activeOpacity={0.8}>
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>🗺️  Open Navigation</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
