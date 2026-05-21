import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { getCurrentLocation, reverseGeocode } from '../utils/location';

const GHANA_AREAS = [
  'East Legon', 'Accra Mall Area', 'Osu', 'Labone', 'Cantonments',
  'Airport Residential', 'Adenta', 'Tema', 'Spintex', 'Achimota',
  'Madina', 'Kasoa', 'Dansoman', 'Lapaz', 'Kumasi Central',
  'Kumasi Adum', 'Cape Coast', 'Takoradi', 'Tamale', 'Ho', 'Other',
];

export default function LocationPicker({ value, onChange, placeholder = 'Select job location' }) {
  const [isDetecting, setIsDetecting] = useState(false);
  const [addressText, setAddressText] = useState(value?.address || '');
  const [showAreaPicker, setShowAreaPicker] = useState(false);

  useEffect(() => {
    setAddressText(value?.address || '');
  }, [value?.address]);

  const handleDetectLocation = async () => {
    setIsDetecting(true);
    try {
      const coords = await getCurrentLocation();
      if (coords) {
        const address = await reverseGeocode(coords.latitude, coords.longitude);
        setAddressText(address);
        onChange({ latitude: coords.latitude, longitude: coords.longitude, address });
      }
    } finally {
      setIsDetecting(false);
    }
  };

  const handleAreaSelect = (area) => {
    setAddressText(`${area}, Accra, Ghana`);
    setShowAreaPicker(false);
    onChange({ latitude: null, longitude: null, address: `${area}, Accra, Ghana`, area });
  };

  const handleTextChange = (text) => {
    setAddressText(text);
    onChange({ latitude: null, longitude: null, address: text });
  };

  return (
    <View style={{ gap: 10 }}>
      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#eff6ff', borderWidth: 1.5, borderColor: '#1d4ed8', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, gap: 10 }}
        onPress={handleDetectLocation}
        disabled={isDetecting}
        activeOpacity={0.8}
      >
        {isDetecting ? (
          <ActivityIndicator size="small" color="#1d4ed8" />
        ) : (
          <Text style={{ fontSize: 18 }}>📍</Text>
        )}
        <Text style={{ color: '#1d4ed8', fontSize: 15, fontWeight: '600' }}>
          {isDetecting ? 'Detecting...' : 'Use My Current Location'}
        </Text>
      </TouchableOpacity>

      <TextInput
        style={{ borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#0f172a', backgroundColor: '#fff', minHeight: 48 }}
        value={addressText}
        onChangeText={handleTextChange}
        placeholder={placeholder}
        placeholderTextColor="#94a3b8"
      />

      <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4 }} onPress={() => setShowAreaPicker(!showAreaPicker)} activeOpacity={0.8}>
        <Text style={{ color: '#64748b', fontSize: 13, fontWeight: '500' }}>🗺️ Pick Neighbourhood</Text>
      </TouchableOpacity>

      {showAreaPicker ? (
        <View style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, maxHeight: 240, overflow: 'hidden' }}>
          {GHANA_AREAS.map((area) => (
            <TouchableOpacity key={area} style={{ paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }} onPress={() => handleAreaSelect(area)} activeOpacity={0.7}>
              <Text style={{ fontSize: 14, color: '#334155' }}>{area}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {value?.latitude && value?.longitude ? (
        <View style={{ backgroundColor: '#d1fae5', borderRadius: 8, padding: 10 }}>
          <Text style={{ fontSize: 12, color: '#059669', fontWeight: '500' }}>✅ GPS Location Captured — Providers can navigate directly to you</Text>
        </View>
      ) : null}

      {value?.address && !value?.latitude ? (
        <View style={{ backgroundColor: '#fef3c7', borderRadius: 8, padding: 10 }}>
          <Text style={{ fontSize: 12, color: '#d97706', fontWeight: '500' }}>ℹ️ Text address only - tap Use My Current Location for GPS navigation</Text>
        </View>
      ) : null}
    </View>
  );
}
