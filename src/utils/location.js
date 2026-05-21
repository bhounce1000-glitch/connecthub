import * as Linking from 'expo-linking';
import * as Location from 'expo-location';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Alert, Platform } from 'react-native';

import { db } from '../firebase';

export async function requestLocationPermission() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert(
      'Location Permission Required',
      'ConnectHub needs access to your location to help providers navigate to job sites and show nearby jobs.',
      [{ text: 'OK' }]
    );
    return false;
  }
  return true;
}

export async function getCurrentLocation() {
  try {
    const granted = await requestLocationPermission();
    if (!granted) return null;

    const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy,
    };
  } catch (error) {
    console.error('Get location error:', error.message);
    return null;
  }
}

export async function reverseGeocode(latitude, longitude) {
  try {
    const results = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (results && results.length > 0) {
      const r = results[0];
      const parts = [r.name, r.street, r.district, r.city || r.region, r.country].filter(Boolean);
      return parts.join(', ');
    }
    return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
  } catch {
    return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
  }
}

export async function geocodeAddress(addressText) {
  try {
    const results = await Location.geocodeAsync(addressText);
    if (results && results.length > 0) {
      return { latitude: results[0].latitude, longitude: results[0].longitude };
    }
    return null;
  } catch {
    return null;
  }
}

export function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function formatDistance(km) {
  if (km == null || Number.isNaN(km)) return '';
  if (km < 1) return `${Math.round(km * 1000)}m away`;
  if (km < 10) return `${km.toFixed(1)}km away`;
  return `${Math.round(km)}km away`;
}

export function estimateTravelTime(km, speedKmh = 30) {
  const minutes = (km / speedKmh) * 60;
  if (minutes < 1) return 'Less than 1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hours}h ${mins}min`;
}

export function openGoogleMapsNavigation(destLat, destLon, destLabel = 'Job Location') {
  const encodedLabel = encodeURIComponent(destLabel);
  const url = Platform.select({
    ios: `comgooglemaps://?daddr=${destLat},${destLon}&directionsmode=driving`,
    android: `google.navigation:q=${destLat},${destLon}&mode=d`,
    default: `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLon}&destination_place_id=${encodedLabel}&travelmode=driving`,
  });
  const fallbackUrl = `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLon}&travelmode=driving`;

  Linking.canOpenURL(url).then((supported) => {
    if (supported) {
      Linking.openURL(url);
    } else {
      Linking.openURL(fallbackUrl);
    }
  }).catch(() => {
    Linking.openURL(fallbackUrl);
  });
}

export function openAppleMapsNavigation(destLat, destLon) {
  const url = `maps://?daddr=${destLat},${destLon}&dirflg=d&t=m`;
  const fallback = `https://maps.apple.com/?daddr=${destLat},${destLon}&dirflg=d`;

  Linking.canOpenURL(url).then((supported) => {
    if (supported) {
      Linking.openURL(url);
    } else {
      Linking.openURL(fallback);
    }
  }).catch(() => {
    Linking.openURL(fallback);
  });
}

export function openBestNavigation(destLat, destLon, destLabel = 'Job Location', showPicker = true) {
  if (!destLat || !destLon) {
    Alert.alert('Location Not Available', 'The exact location coordinates for this job are not available. Please contact the customer for directions.');
    return;
  }

  if (Platform.OS === 'ios' && showPicker) {
    Alert.alert(
      'Open Navigation',
      `Navigate to ${destLabel}`,
      [
        { text: 'Google Maps', onPress: () => openGoogleMapsNavigation(destLat, destLon, destLabel) },
        { text: 'Apple Maps', onPress: () => openAppleMapsNavigation(destLat, destLon, destLabel) },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  } else {
    openGoogleMapsNavigation(destLat, destLon, destLabel);
  }
}

// Start live GPS tracking, write position to Firestore liveLocations/{jobId}.
// Returns an async cleanup function — call it on unmount or when the job ends.
export async function startLiveTracking(jobId, providerEmail, onLocationUpdate) {
  const granted = await requestLocationPermission();
  if (!granted) return null;

  const locationRef = doc(db, 'liveLocations', jobId);
  let subscription = null;

  try {
    subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 5000,
        distanceInterval: 20,
      },
      async (location) => {
        const coords = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          heading: location.coords.heading || 0,
          speed: location.coords.speed || 0,
          providerEmail,
          jobId,
          updatedAt: serverTimestamp(),
          timestamp: Date.now(),
        };

        try {
          await setDoc(locationRef, coords, { merge: true });
        } catch (e) {
          console.error('Live location write error:', e.message);
        }

        if (onLocationUpdate) onLocationUpdate(coords);
      }
    );
  } catch (e) {
    console.error('startLiveTracking error:', e.message);
    return null;
  }

  return async () => {
    if (subscription) subscription.remove();
    try {
      await deleteDoc(locationRef);
    } catch {
      // Ignore cleanup errors — document may already be gone.
    }
  };
}

// Legacy alias kept for backward compatibility.
export async function watchProviderLocation(callback) {
  const granted = await requestLocationPermission();
  if (!granted) return null;

  const subscription = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.Balanced, timeInterval: 10000, distanceInterval: 50 },
    (location) => {
      callback({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        heading: location.coords.heading,
        speed: location.coords.speed,
        timestamp: location.timestamp,
      });
    }
  );

  return () => subscription.remove();
}

// Decode a Google Maps encoded polyline string into an array of {latitude, longitude}.
export function decodePolyline(encoded) {
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

// Fetch a driving route from Google Directions API.
// Falls back to a straight-line pair of coordinates when the API is unavailable.
export async function getDirectionsRoute(originLat, originLon, destLat, destLon) {
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  const fallback = [
    { latitude: originLat, longitude: originLon },
    { latitude: destLat, longitude: destLon },
  ];

  if (!apiKey) return fallback;

  try {
    const url =
      `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${originLat},${originLon}` +
      `&destination=${destLat},${destLon}` +
      `&mode=driving` +
      `&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OK' && data.routes && data.routes.length > 0) {
      const points = data.routes[0].overview_polyline.points;
      return decodePolyline(points);
    }
  } catch (e) {
    console.error('Directions API error:', e.message);
  }

  return fallback;
}

export function getLocationLabel(locationValue) {
  if (!locationValue) return '';
  if (typeof locationValue === 'string') return locationValue;

  const city = String(locationValue.city || '').trim();
  const area = String(locationValue.area || '').trim();
  const legacy = String(locationValue.label || locationValue.text || '').trim();

  if (area && city) return `${area}, ${city}`;
  if (city) return city;
  if (area) return area;
  return legacy;
}

export function getLocationCity(locationValue) {
  if (!locationValue || typeof locationValue === 'string') {
    return '';
  }
  return String(locationValue.city || '').trim();
}

export function getLocationCoords(locationValue) {
  if (!locationValue || typeof locationValue === 'string') {
    return null;
  }

  let latitude = Number(locationValue.coordinates?.latitude);
  let longitude = Number(locationValue.coordinates?.longitude);
  if (!Number.isFinite(latitude)) latitude = Number(locationValue.latitude);
  if (!Number.isFinite(longitude)) longitude = Number(locationValue.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return { latitude, longitude };
}

export function distanceKm(fromCoords, toCoords) {
  if (!fromCoords || !toCoords) return null;

  const lat1 = Number(fromCoords.latitude);
  const lon1 = Number(fromCoords.longitude);
  const lat2 = Number(toCoords.latitude);
  const lon2 = Number(toCoords.longitude);

  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;

  return calculateDistance(lat1, lon1, lat2, lon2);
}
