import { useLocalSearchParams, useRouter } from 'expo-router';
import { addDoc, collection, doc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Dimensions,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

import MapPreview from '../components/MapPreview';
import NavigateButton from '../components/NavigateButton';
import { auth, db } from '../firebase';
import {
    calculateDistance,
    estimateTravelTime,
    formatDistance,
    getCurrentLocation,
    getDirectionsRoute,
    openBestNavigation,
    startLiveTracking,
} from '../utils/location';

// react-native-maps is not supported on web — load lazily.
let MapView = null;
let Marker = null;
let Polyline = null;
let PROVIDER_GOOGLE = null;
if (Platform.OS !== 'web') {
  const maps = require('react-native-maps');
  MapView = maps.default;
  Marker = maps.Marker;
  Polyline = maps.Polyline;
  PROVIDER_GOOGLE = maps.PROVIDER_GOOGLE;
}

const { width, height } = Dimensions.get('window');
const ASPECT_RATIO = width / height;
const LATITUDE_DELTA = 0.02;
const LONGITUDE_DELTA = LATITUDE_DELTA * ASPECT_RATIO;

export default function LiveMapScreen() {
  const router = useRouter();
  const {
    jobId,
    jobTitle,
    customerLat,
    customerLon,
    customerAddress,
    isProvider,
  } = useLocalSearchParams();

  const mapRef = useRef(null);
  const currentEmail = auth.currentUser?.email;

  const customerLatNum = parseFloat(customerLat);
  const customerLonNum = parseFloat(customerLon);
  const isProviderView = isProvider === 'true';

  const [myLocation, setMyLocation] = useState(null);
  const [providerLocation, setProviderLocation] = useState(null);
  const [routeCoords, setRouteCoords] = useState([]);
  const [distance, setDistance] = useState(null);
  const [eta, setEta] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isTracking, setIsTracking] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [providerArrived, setProviderArrived] = useState(false);
  const hasNotifiedArrival = useRef(false);
  // If route has only 2 points it is a straight-line fallback (no API key or error).
  const isFallbackRoute = routeCoords.length === 2;

  // Fetch route and update distance/ETA whenever origin changes.
  const updateRoute = useCallback(
    async (fromLocation) => {
      if (
        !fromLocation ||
        !Number.isFinite(customerLatNum) ||
        !Number.isFinite(customerLonNum)
      ) {
        return;
      }

      try {
        const coords = await getDirectionsRoute(
          fromLocation.latitude,
          fromLocation.longitude,
          customerLatNum,
          customerLonNum
        );
        setRouteCoords(coords);

        const km = calculateDistance(
          fromLocation.latitude,
          fromLocation.longitude,
          customerLatNum,
          customerLonNum
        );
        setDistance(formatDistance(km));
        setEta(estimateTravelTime(km));
      } catch (e) {
        console.error('updateRoute error:', e.message);
      }
    },
    [customerLatNum, customerLonNum]
  );

  // Get my current location on mount.
  useEffect(() => {
    getCurrentLocation()
      .then((loc) => {
        if (loc) setMyLocation(loc);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  // Provider: start live Firestore tracking.
  useEffect(() => {
    if (!isProviderView || !jobId || !currentEmail) return undefined;

    let cleanup = null;

    startLiveTracking(jobId, currentEmail, (newLocation) => {
      setMyLocation(newLocation);
      updateRoute(newLocation).catch(() => {});
    })
      .then((stopFn) => {
        cleanup = stopFn;
        setIsTracking(true);
      })
      .catch((e) => {
        console.error('startLiveTracking failed:', e?.message);
      });

    return () => {
      if (typeof cleanup === 'function') {
        cleanup().catch(() => {});
      }
      setIsTracking(false);
    };
  }, [isProviderView, jobId, currentEmail, updateRoute]);

  // Customer: listen for provider's live location via Firestore onSnapshot.
  useEffect(() => {
    if (isProviderView || !jobId) return undefined;

    const locationRef = doc(db, 'liveLocations', jobId);
    const unsub = onSnapshot(
      locationRef,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        const loc = {
          latitude: data.latitude,
          longitude: data.longitude,
          heading: data.heading || 0,
        };
        setProviderLocation(loc);
        updateRoute(loc).catch(() => {});

        // Geofencing: notify customer when provider is within 200 m.
        if (
          Number.isFinite(customerLatNum) &&
          Number.isFinite(customerLonNum) &&
          !hasNotifiedArrival.current
        ) {
          const distToJob = calculateDistance(
            data.latitude,
            data.longitude,
            customerLatNum,
            customerLonNum
          );
          if (distToJob < 0.2) {
            hasNotifiedArrival.current = true;
            setProviderArrived(true);
            addDoc(collection(db, 'notifications'), {
              userId: auth.currentUser?.email,
              recipientId: auth.currentUser?.email,
              user: auth.currentUser?.email,
              title: '\uD83D\uDEE0\uFE0F Provider Has Arrived!',
              body: 'Your provider is at your location. Please let them in.',
              type: 'provider_arrived',
              jobId,
              read: false,
              createdAt: serverTimestamp(),
            }).catch(() => {});
          }
        }
      },
      (err) => {
        console.error('liveLocations snapshot error:', err.message);
      }
    );

    return unsub;
  }, [isProviderView, jobId, updateRoute, customerLatNum, customerLonNum]);

  // Fetch initial route once location is known.
  useEffect(() => {
    const origin = isProviderView ? myLocation : providerLocation;
    if (origin) {
      updateRoute(origin).catch(() => {});
    }
  }, [myLocation, providerLocation, isProviderView, updateRoute]);

  // Fit the map to show all relevant markers.
  const fitMapToMarkers = useCallback(() => {
    if (!mapRef.current || !mapReady) return;

    const markers = [];
    if (myLocation)
      markers.push({
        latitude: myLocation.latitude,
        longitude: myLocation.longitude,
      });
    if (providerLocation)
      markers.push({
        latitude: providerLocation.latitude,
        longitude: providerLocation.longitude,
      });
    if (Number.isFinite(customerLatNum) && Number.isFinite(customerLonNum))
      markers.push({ latitude: customerLatNum, longitude: customerLonNum });

    if (markers.length >= 2) {
      mapRef.current.fitToCoordinates(markers, {
        edgePadding: { top: 80, right: 60, bottom: 240, left: 60 },
        animated: true,
      });
    }
  }, [myLocation, providerLocation, customerLatNum, customerLonNum, mapReady]);

  // Re-fit whenever route updates.
  useEffect(() => {
    if (routeCoords.length > 1) fitMapToMarkers();
  }, [routeCoords, fitMapToMarkers]);

  const initialRegion = {
    latitude:
      (Number.isFinite(customerLatNum) ? customerLatNum : null) ||
      myLocation?.latitude ||
      5.6037,
    longitude:
      (Number.isFinite(customerLonNum) ? customerLonNum : null) ||
      myLocation?.longitude ||
      -0.187,
    latitudeDelta: LATITUDE_DELTA,
    longitudeDelta: LONGITUDE_DELTA,
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1d4ed8" />
        <Text style={styles.loadingText}>Getting your location...</Text>
      </View>
    );
  }

  // Web fallback — react-native-maps does not support web.
  if (Platform.OS === 'web' || !MapView) {
    const webDistanceKm =
      Number.isFinite(customerLatNum) && Number.isFinite(customerLonNum) && myLocation
        ? calculateDistance(
            myLocation.latitude,
            myLocation.longitude,
            customerLatNum,
            customerLonNum
          )
        : null;

    return (
      <View style={styles.webFallback}>
        <Text style={styles.webFallbackIcon}>🗺️</Text>
        <Text style={styles.webFallbackTitle}>Live Map</Text>
        <Text style={styles.webFallbackText}>
          Live tracking is available on the mobile app. Use the navigation button below to open Google Maps.
        </Text>

        {webDistanceKm !== null && (
          <View style={{ flexDirection: 'row', gap: 12, justifyContent: 'center', marginBottom: 12 }}>
            <View style={styles.statChip}>
              <Text style={styles.statIcon}>📍</Text>
              <Text style={styles.statText}>{formatDistance(webDistanceKm)}</Text>
            </View>
            <View style={styles.statChip}>
              <Text style={styles.statIcon}>⏱️</Text>
              <Text style={styles.statText}>{estimateTravelTime(webDistanceKm)}</Text>
            </View>
          </View>
        )}

        {Number.isFinite(customerLatNum) && Number.isFinite(customerLonNum) && (
          <MapPreview
            latitude={customerLatNum}
            longitude={customerLonNum}
            label={customerAddress || 'Job Location'}
            height={140}
            showNavigateButton={false}
          />
        )}

        {Number.isFinite(customerLatNum) && Number.isFinite(customerLonNum) && (
          <NavigateButton
            destLat={customerLatNum}
            destLon={customerLonNum}
            destLabel={customerAddress || 'Job Location'}
            providerLat={myLocation?.latitude}
            providerLon={myLocation?.longitude}
            style={{ marginTop: 12 }}
          />
        )}

        <TouchableOpacity
          style={styles.backButtonWeb}
          onPress={() => router.back()}
          accessibilityLabel="Go back"
          activeOpacity={0.8}
        >
          <Text style={styles.backButtonWebText}>← Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* MAP */}
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={initialRegion}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass
        showsTraffic={false}
        onMapReady={() => {
          setMapReady(true);
          fitMapToMarkers();
        }}
      >
        {/* Job / customer destination marker (red) */}
        {Number.isFinite(customerLatNum) && Number.isFinite(customerLonNum) && (
          <Marker
            coordinate={{ latitude: customerLatNum, longitude: customerLonNum }}
            title="Job Location"
            description={customerAddress || 'Customer location'}
            pinColor="#dc2626"
          />
        )}

        {/* My location marker — blue dot */}
        {myLocation && (
          <Marker
            coordinate={{
              latitude: myLocation.latitude,
              longitude: myLocation.longitude,
            }}
            title="Your Location"
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.myLocationDot}>
              <View style={styles.myLocationInner} />
            </View>
          </Marker>
        )}

        {/* Provider location marker — shown on customer view */}
        {!isProviderView && providerLocation && (
          <Marker
            coordinate={{
              latitude: providerLocation.latitude,
              longitude: providerLocation.longitude,
            }}
            title="Provider"
            description="Provider is on the way"
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.providerMarker}>
              <Text style={styles.providerMarkerIcon}>🛠️</Text>
            </View>
          </Marker>
        )}

        {/* Route polyline — dashed when using fallback straight-line */}
        {routeCoords.length > 1 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor={isFallbackRoute ? '#94a3b8' : '#1d4ed8'}
            strokeWidth={isFallbackRoute ? 2 : 4}
            lineDashPattern={isFallbackRoute ? [8, 6] : []}
          />
        )}
      </MapView>

      {/* Back button */}
      <TouchableOpacity
        style={styles.backBtn}
        onPress={() => router.back()}
        accessibilityLabel="Go back"
        activeOpacity={0.8}
      >
        <Text style={styles.backBtnText}>\u2190</Text>
      </TouchableOpacity>

      {/* Re-center button */}
      <TouchableOpacity
        style={styles.recenterBtn}
        onPress={fitMapToMarkers}
        accessibilityLabel="Re-center map"
        activeOpacity={0.8}
      >
        <Text style={styles.recenterBtnText}>\u2295</Text>
      </TouchableOpacity>

      {/* Provider arrived banner — customer view only */}
      {providerArrived && !isProviderView ? (
        <View style={styles.arrivedBanner}>
          <Text style={{ fontSize: 24, marginBottom: 4 }}>\uD83C\uDF89</Text>
          <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800' }}>
            Provider Has Arrived!
          </Text>
          <Text style={{ color: '#a7f3d0', fontSize: 13, marginTop: 4 }}>
            Your provider is at your location
          </Text>
        </View>
      ) : null}

      {/* BOTTOM INFO PANEL */}
      <View style={styles.bottomPanel}>
        <Text style={styles.jobTitle} numberOfLines={1}>
          {jobTitle || 'Active Job'}
        </Text>

        {distance && eta ? (
          <View style={styles.statsRow}>
            <View style={styles.statChip}>
              <Text style={styles.statIcon}>📍</Text>
              <Text style={styles.statText}>{distance}</Text>
            </View>
            <View style={styles.statChip}>
              <Text style={styles.statIcon}>⏱️</Text>
              <Text style={styles.statText}>{eta}</Text>
            </View>
            {isTracking ? (
              <View style={[styles.statChip, styles.liveChip]}>
                <View style={styles.liveDot} />
                <Text style={[styles.statText, { color: '#059669' }]}>LIVE</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Customer view — provider tracking status */}
        {!isProviderView ? (
          <View style={styles.statusRow}>
            <Text
              style={
                providerLocation
                  ? styles.statusText
                  : styles.statusTextWaiting
              }
            >
              {providerLocation
                ? '🛠️  Provider is on the way — tracking live'
                : '⏳  Waiting for provider to start tracking...'}
            </Text>
          </View>
        ) : null}

        {/* Fallback route notice */}
        {isFallbackRoute && routeCoords.length > 0 && (
          <View style={styles.fallbackNotice}>
            <Text style={styles.fallbackNoticeText}>
              Approximate route — add Google Maps API key for exact directions
            </Text>
          </View>
        )}

        {/* Provider view — tracking status */}
        {isProviderView ? (
          <View style={styles.statusRow}>
            <Text style={isTracking ? styles.statusText : styles.statusTextWaiting}>
              {isTracking
                ? '📡  Sharing your live location with customer'
                : '📍  Acquiring location...'}
            </Text>
          </View>
        ) : null}

        {/* Turn-by-turn navigation button (provider only) */}
        {isProviderView &&
          Number.isFinite(customerLatNum) &&
          Number.isFinite(customerLonNum) ? (
          <TouchableOpacity
            style={styles.navButton}
            onPress={() =>
              openBestNavigation(
                customerLatNum,
                customerLonNum,
                customerAddress || 'Job Location'
              )
            }            accessibilityLabel="Start turn-by-turn navigation"            activeOpacity={0.8}
          >
            <Text style={styles.navButtonText}>
              🗺️  Start Turn-by-Turn Navigation
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  map: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    gap: 16,
  },
  loadingText: {
    fontSize: 15,
    color: '#64748b',
    fontWeight: '500',
  },
  webFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    padding: 32,
    gap: 16,
  },
  webFallbackIcon: { fontSize: 64 },
  webFallbackTitle: { fontSize: 24, fontWeight: '800', color: '#0f172a' },
  webFallbackText: {
    fontSize: 15,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 22,
  },
  arrivedBanner: {
    position: 'absolute',
    top: 60,
    left: 16,
    right: 16,
    backgroundColor: '#059669',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  fallbackNotice: {
    backgroundColor: '#fef3c7',
    borderRadius: 8,
    padding: 10,
    marginTop: 2,
    marginBottom: 0,
  },
  fallbackNoticeText: {
    fontSize: 12,
    color: '#92400e',
    fontWeight: '600',
    textAlign: 'center',
  },
  openMapsButton: {
    backgroundColor: '#1d4ed8',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
    marginTop: 8,
  },
  openMapsButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  backButtonWeb: {
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  backButtonWebText: { color: '#475569', fontSize: 15, fontWeight: '600' },
  backBtn: {
    position: 'absolute',
    top: 52,
    left: 16,
    backgroundColor: '#fff',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 6,
  },
  backBtnText: { fontSize: 20, color: '#0f172a' },
  recenterBtn: {
    position: 'absolute',
    top: 108,
    right: 16,
    backgroundColor: '#fff',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 6,
  },
  recenterBtnText: { fontSize: 22, color: '#1d4ed8' },
  bottomPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 16,
    gap: 12,
  },
  jobTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 14,
    gap: 6,
  },
  liveChip: { backgroundColor: '#d1fae5' },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#059669',
  },
  statIcon: { fontSize: 14 },
  statText: { fontSize: 13, color: '#1d4ed8', fontWeight: '600' },
  statusRow: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
  },
  statusText: { fontSize: 13, color: '#059669', fontWeight: '600' },
  statusTextWaiting: { fontSize: 13, color: '#d97706', fontWeight: '600' },
  navButton: {
    backgroundColor: '#1d4ed8',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  navButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  myLocationDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(29,78,216,0.2)',
    borderWidth: 2,
    borderColor: '#1d4ed8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  myLocationInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1d4ed8',
  },
  providerMarker: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 6,
    borderWidth: 2,
    borderColor: '#1d4ed8',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  providerMarkerIcon: { fontSize: 20 },
});
