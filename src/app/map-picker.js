import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Text, TouchableOpacity, View } from 'react-native';

import { AppRadius, AppSpace } from '../constants/design-tokens';

let NativeMapView = null;
let NativeMarker = null;
if (Platform.OS !== 'web') {
  const maps = require('react-native-maps');
  NativeMapView = maps.default;
  NativeMarker = maps.Marker;
}

const ACCRA_FALLBACK = {
  latitude: 5.6037,
  longitude: -0.187,
};

function normalizeCoord(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function MapPickerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const initialCoords = useMemo(() => {
    return {
      latitude: normalizeCoord(params?.latitude, ACCRA_FALLBACK.latitude),
      longitude: normalizeCoord(params?.longitude, ACCRA_FALLBACK.longitude),
    };
  }, [params?.latitude, params?.longitude]);

  const [selected, setSelected] = useState(initialCoords);
  const [isLocating, setIsLocating] = useState(false);
  const [resolvedArea, setResolvedArea] = useState(typeof params?.area === 'string' ? params.area : '');
  const [resolvedAddress, setResolvedAddress] = useState(typeof params?.fullAddress === 'string' ? params.fullAddress : '');

  const resolveAddress = async (latitude, longitude) => {
    try {
      const rows = await Location.reverseGeocodeAsync({ latitude, longitude });
      const best = rows?.[0] || {};
      const area = String(best.district || best.subregion || best.city || '').trim();
      const address = [best.name, best.street, best.city].filter(Boolean).join(', ').trim();
      if (area) setResolvedArea(area);
      if (address) setResolvedAddress(address);
    } catch {
      // Ignore reverse geocode failures and keep manual address fields.
    }
  };

  const handleUseCurrentLocation = async () => {
    setIsLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location permission required', 'Enable location access to use your current position.');
        return;
      }

      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const latitude = Number(current?.coords?.latitude);
      const longitude = Number(current?.coords?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        Alert.alert('Location unavailable', 'Could not determine your current location.');
        return;
      }

      setSelected({ latitude, longitude });
      await resolveAddress(latitude, longitude);
    } catch {
      Alert.alert('Location unavailable', 'Could not determine your current location.');
    } finally {
      setIsLocating(false);
    }
  };

  const handleConfirm = () => {
    if (!selected) return;

    router.replace({
      pathname: '/request-wizard',
      params: {
        mapLat: String(selected.latitude),
        mapLng: String(selected.longitude),
        mapArea: resolvedArea || String(params?.area || '').trim(),
        mapAddress: resolvedAddress || String(params?.fullAddress || '').trim(),
      },
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc', padding: AppSpace.lg }}>
      <Text style={{ color: '#0f172a', fontSize: 24, fontWeight: '800', marginBottom: 6 }}>Pick Exact Job Location</Text>
      <Text style={{ color: '#475569', marginBottom: 12 }}>
        Tap on the map to set the job pin. This is used for provider directions after acceptance.
      </Text>

      {Platform.OS === 'web' || !NativeMapView ? (
        <View style={{
          backgroundColor: '#fff',
          borderRadius: AppRadius.lg,
          borderWidth: 1,
          borderColor: '#cbd5e1',
          padding: 14,
          marginBottom: 12,
        }}>
          <Text style={{ color: '#334155', marginBottom: 8 }}>
            Interactive map selection is available on Android and iPhone builds.
          </Text>
          <Text style={{ color: '#64748b', fontSize: 12 }}>
            Use Current Location to set coordinates on this platform.
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1, borderRadius: AppRadius.lg, overflow: 'hidden', marginBottom: 12 }}>
          <NativeMapView
            style={{ flex: 1 }}
            initialRegion={{
              latitude: selected.latitude,
              longitude: selected.longitude,
              latitudeDelta: 0.02,
              longitudeDelta: 0.02,
            }}
            onPress={(event) => {
              const latitude = Number(event?.nativeEvent?.coordinate?.latitude);
              const longitude = Number(event?.nativeEvent?.coordinate?.longitude);
              if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
              setSelected({ latitude, longitude });
              resolveAddress(latitude, longitude).catch(() => {});
            }}
          >
            {selected && NativeMarker ? <NativeMarker coordinate={selected} title="Job location" /> : null}
          </NativeMapView>
        </View>
      )}

      <View style={{ backgroundColor: '#fff', borderRadius: AppRadius.md, borderWidth: 1, borderColor: '#e2e8f0', padding: 12, marginBottom: 10 }}>
        <Text style={{ color: '#0f172a', fontWeight: '700' }}>Selected Coordinates</Text>
        <Text style={{ color: '#334155', marginTop: 4 }}>
          {selected ? `${selected.latitude.toFixed(6)}, ${selected.longitude.toFixed(6)}` : 'No pin selected'}
        </Text>
        {resolvedArea ? <Text style={{ color: '#334155', marginTop: 4 }}>Area: {resolvedArea}</Text> : null}
        {resolvedAddress ? <Text style={{ color: '#64748b', marginTop: 2 }}>Address: {resolvedAddress}</Text> : null}
      </View>

      <TouchableOpacity
        onPress={handleUseCurrentLocation}
        disabled={isLocating}
        style={{
          height: 46,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: '#93c5fd',
          backgroundColor: '#eff6ff',
          marginBottom: 8,
        }}
      >
        {isLocating
          ? <ActivityIndicator color="#1d4ed8" />
          : <Text style={{ color: '#1d4ed8', fontWeight: '800' }}>Use Current Location</Text>}
      </TouchableOpacity>

      <TouchableOpacity
        onPress={handleConfirm}
        style={{
          height: 50,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#2563eb',
          marginBottom: 8,
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '900' }}>Confirm Location</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.back()} style={{ alignItems: 'center', paddingVertical: 8 }}>
        <Text style={{ color: '#64748b', fontWeight: '700' }}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}
