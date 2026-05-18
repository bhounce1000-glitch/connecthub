import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { API_BASE_URL } from '../constants/api';
import { AppRadius, AppSpace } from '../constants/design-tokens';
import { apiPost, assertApiSuccess } from '../utils/api-client';

const CATEGORIES = [
  { name: 'Cleaning', icon: '🧹' },
  { name: 'Plumbing', icon: '🔧' },
  { name: 'Electrical', icon: '⚡' },
  { name: 'Delivery', icon: '🚗' },
  { name: 'Moving', icon: '📦' },
  { name: 'Cooking', icon: '🍳' },
  { name: 'Beauty', icon: '💇' },
  { name: 'Tech Support', icon: '🖥️' },
  { name: 'Gardening', icon: '🌿' },
  { name: 'Other', icon: '➕' },
];

const AREAS = [
  'East Legon',
  'Tema',
  'Osu',
  'Labone',
  'Cantonments',
  'Adenta',
  'Spintex',
  'Achimota',
  'Kumasi',
  'Takoradi',
  'Cape Coast',
  'Other',
];

function todayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function RequestWizard() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const [step, setStep] = useState(1);
  const [category, setCategory] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [budget, setBudget] = useState('');
  const [preferredDate, setPreferredDate] = useState(todayString());
  const [urgency, setUrgency] = useState('normal');
  const [area, setArea] = useState('');
  const [fullAddress, setFullAddress] = useState('');
  const [pickedCoords, setPickedCoords] = useState(null);
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [successRef, setSuccessRef] = useState('');

  useEffect(() => {
    const paramLat = Number(params?.mapLat);
    const paramLng = Number(params?.mapLng);
    if (Number.isFinite(paramLat) && Number.isFinite(paramLng)) {
      setPickedCoords({ latitude: paramLat, longitude: paramLng });
    }
    if (typeof params?.mapArea === 'string' && params.mapArea.trim()) {
      setArea(params.mapArea.trim());
    }
    if (typeof params?.mapAddress === 'string' && params.mapAddress.trim()) {
      setFullAddress(params.mapAddress.trim());
    }
  }, [params?.mapAddress, params?.mapArea, params?.mapLat, params?.mapLng]);

  const titleError = useMemo(() => {
    const len = title.trim().length;
    if (len === 0) return 'Title is required';
    if (len < 5) return 'Minimum 5 characters';
    if (len > 80) return 'Maximum 80 characters';
    return '';
  }, [title]);

  const descriptionError = useMemo(() => {
    const len = description.trim().length;
    if (len === 0) return 'Description is required';
    if (len < 20) return 'Minimum 20 characters';
    if (len > 500) return 'Maximum 500 characters';
    return '';
  }, [description]);

  const budgetError = useMemo(() => {
    const value = Number(budget);
    if (!budget.trim()) return 'Budget is required';
    if (!Number.isFinite(value)) return 'Budget must be numeric';
    if (value < 10) return 'Minimum budget is GHS 10';
    return '';
  }, [budget]);

  const dateError = useMemo(() => {
    const parsed = new Date(preferredDate).getTime();
    const floorToday = new Date();
    floorToday.setHours(0, 0, 0, 0);
    if (!preferredDate.trim()) return 'Preferred date is required';
    if (!Number.isFinite(parsed)) return 'Invalid date';
    if (parsed < floorToday.getTime()) return 'Date must be today or later';
    return '';
  }, [preferredDate]);

  const step1Valid = category.length > 0;
  const step2Valid = !titleError && !descriptionError && !budgetError && !dateError;
  const hasExactCoords = Number.isFinite(pickedCoords?.latitude) && Number.isFinite(pickedCoords?.longitude);
  const step3Valid = area.length > 0 && hasExactCoords && specialInstructions.length <= 200;

  const handleUseCurrentLocation = async () => {
    setSubmitError('');
    setIsLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setSubmitError('Location permission is required to use current location.');
        return;
      }

      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const latitude = Number(current?.coords?.latitude);
      const longitude = Number(current?.coords?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        setSubmitError('Could not determine your current location.');
        return;
      }

      setPickedCoords({ latitude, longitude });

      const geocodeRows = await Location.reverseGeocodeAsync({ latitude, longitude });
      const best = geocodeRows?.[0] || {};
      const derivedArea = String(best.district || best.subregion || best.city || area || 'Current area').trim();
      const derivedAddress = [best.name, best.street, best.city].filter(Boolean).join(', ').trim();

      if (derivedArea) setArea(derivedArea);
      if (derivedAddress) setFullAddress(derivedAddress);
    } catch {
      setSubmitError('Could not get your current location right now.');
    } finally {
      setIsLocating(false);
    }
  };

  const handlePost = async () => {
    setSubmitError('');
    if (!step1Valid || !step2Valid || !step3Valid) {
      setSubmitError('Please complete all required fields before posting.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        category,
        title: title.trim(),
        description: description.trim(),
        budget: Number(budget),
        preferredDate,
        urgency,
        location: {
          area,
          fullAddress: fullAddress.trim(),
          specialInstructions: specialInstructions.trim(),
          latitude: pickedCoords.latitude,
          longitude: pickedCoords.longitude,
          coordinates: {
            latitude: pickedCoords.latitude,
            longitude: pickedCoords.longitude,
          },
        },
      };

      const { response, data } = await apiPost(`${API_BASE_URL}/api/jobs`, payload, { requireAuth: true });
      assertApiSuccess(response, data, 'Could not post job');
      setSuccessRef(data?.data?.referenceNumber || data?.data?.jobId || 'PENDING');
      setTimeout(() => {
        router.replace('/my-requests');
      }, 2500);
    } catch (error) {
      setSubmitError(error.message || 'Could not post job right now.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (successRef) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center', padding: AppSpace.xl }}>
        <Text style={{ fontSize: 48 }}>🎉</Text>
        <Text style={{ marginTop: 10, fontSize: 24, fontWeight: '800', color: '#0f172a' }}>Job Posted!</Text>
        <Text style={{ marginTop: 8, color: '#334155', textAlign: 'center' }}>Reference: {successRef}</Text>
        <Text style={{ marginTop: 8, color: '#64748b', textAlign: 'center' }}>Redirecting to My Requests...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f8fafc' }} contentContainerStyle={{ padding: AppSpace.lg }}>
      <Text style={{ color: '#64748b', fontWeight: '700' }}>STEP {step} OF 4</Text>
      <Text style={{ color: '#0f172a', fontSize: 24, fontWeight: '800', marginTop: 4 }}>Post a Job</Text>

      {submitError ? (
        <View style={{ backgroundColor: '#fee2e2', borderRadius: 10, padding: 10, marginTop: 12 }}>
          <Text style={{ color: '#991b1b', fontWeight: '700' }}>{submitError}</Text>
        </View>
      ) : null}

      {step === 1 ? (
        <View style={{ marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          {CATEGORIES.map((item) => {
            const selected = category === item.name;
            return (
              <TouchableOpacity
                key={item.name}
                onPress={() => setCategory(item.name)}
                style={{
                  width: '48%',
                  backgroundColor: selected ? '#dbeafe' : '#fff',
                  borderWidth: 2,
                  borderColor: selected ? '#2563eb' : '#e2e8f0',
                  borderRadius: AppRadius.md,
                  paddingVertical: 16,
                  marginBottom: 10,
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontSize: 28 }}>{item.icon}</Text>
                <Text style={{ marginTop: 4, fontWeight: '800', color: '#0f172a' }}>{item.name}</Text>
                {selected ? <Text style={{ marginTop: 4, color: '#1d4ed8', fontWeight: '800' }}>✓</Text> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {step === 2 ? (
        <View style={{ marginTop: 14 }}>
          <Field label="Title" value={title} onChangeText={setTitle} placeholder="e.g. Deep clean 2-bedroom apartment" />
          {titleError ? <ErrorText text={titleError} /> : null}

          <Field
            label="Description"
            value={description}
            onChangeText={setDescription}
            placeholder="Describe the job clearly"
            multiline
            height={120}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {descriptionError ? <ErrorText text={descriptionError} /> : <View />}
            <Text style={{ color: '#64748b', fontSize: 12 }}>{description.length}/500</Text>
          </View>

          <Field label="Budget" value={budget} onChangeText={setBudget} placeholder="GHS 100" prefix="GHS" keyboardType="numeric" />
          {budgetError ? <ErrorText text={budgetError} /> : null}

          <Field label="Preferred Date" value={preferredDate} onChangeText={setPreferredDate} placeholder="YYYY-MM-DD" />
          {dateError ? <ErrorText text={dateError} /> : null}

          <Text style={{ marginTop: 12, color: '#0f172a', fontWeight: '700' }}>Urgency</Text>
          <View style={{ flexDirection: 'row', marginTop: 8 }}>
            {['normal', 'urgent'].map((value) => {
              const selected = urgency === value;
              return (
                <TouchableOpacity
                  key={value}
                  onPress={() => setUrgency(value)}
                  style={{
                    flex: 1,
                    marginRight: value === 'normal' ? 8 : 0,
                    paddingVertical: 12,
                    borderWidth: 2,
                    borderColor: selected ? (value === 'urgent' ? '#ea580c' : '#2563eb') : '#cbd5e1',
                    backgroundColor: selected ? (value === 'urgent' ? '#ffedd5' : '#dbeafe') : '#fff',
                    borderRadius: 10,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ fontWeight: '800', color: '#0f172a' }}>{value === 'urgent' ? 'Urgent' : 'Normal'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}

      {step === 3 ? (
        <View style={{ marginTop: 14 }}>
          <Text style={{ color: '#0f172a', fontWeight: '700', marginBottom: 8 }}>Exact Job Pin</Text>
          <View style={{ flexDirection: 'row', marginBottom: 10 }}>
            <TouchableOpacity
              onPress={() => router.push({
                pathname: '/map-picker',
                params: {
                  latitude: pickedCoords?.latitude ? String(pickedCoords.latitude) : '',
                  longitude: pickedCoords?.longitude ? String(pickedCoords.longitude) : '',
                  area,
                  fullAddress,
                },
              })}
              style={{
                flex: 1,
                marginRight: 8,
                borderRadius: 10,
                paddingVertical: 12,
                alignItems: 'center',
                backgroundColor: '#2563eb',
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '800' }}>{hasExactCoords ? 'Update Pin on Map' : 'Pick on Map'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleUseCurrentLocation}
              disabled={isLocating}
              style={{
                flex: 1,
                borderRadius: 10,
                paddingVertical: 12,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: '#93c5fd',
                backgroundColor: isLocating ? '#dbeafe' : '#eff6ff',
              }}
            >
              <Text style={{ color: '#1d4ed8', fontWeight: '800' }}>{isLocating ? 'Locating...' : 'Use Current Location'}</Text>
            </TouchableOpacity>
          </View>
          <Text style={{ color: hasExactCoords ? '#166534' : '#b91c1c', fontSize: 12, marginBottom: 8 }}>
            {hasExactCoords
              ? `Pinned at ${pickedCoords.latitude.toFixed(6)}, ${pickedCoords.longitude.toFixed(6)}`
              : 'Select an exact map location before continuing.'}
          </Text>

          <Text style={{ color: '#0f172a', fontWeight: '700', marginBottom: 8 }}>Area / Neighbourhood</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {AREAS.map((value) => {
              const selected = area === value;
              return (
                <TouchableOpacity
                  key={value}
                  onPress={() => setArea(value)}
                  style={{
                    borderWidth: 1,
                    borderColor: selected ? '#2563eb' : '#cbd5e1',
                    backgroundColor: selected ? '#dbeafe' : '#fff',
                    borderRadius: 999,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    marginRight: 8,
                    marginBottom: 8,
                  }}
                >
                  <Text style={{ color: '#0f172a', fontWeight: '700', fontSize: 12 }}>{value}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {!area ? <ErrorText text="Please select an area" /> : null}
          {!hasExactCoords ? <ErrorText text="Please pin exact location on map" /> : null}

          <Field label="Full Address (optional)" value={fullAddress} onChangeText={setFullAddress} placeholder="House number / landmark" />
          <Field
            label="Special Instructions (optional)"
            value={specialInstructions}
            onChangeText={setSpecialInstructions}
            placeholder="Access notes or reminders"
            multiline
            height={90}
          />
          {specialInstructions.length > 200 ? <ErrorText text="Maximum 200 characters" /> : null}
        </View>
      ) : null}

      {step === 4 ? (
        <View style={{ marginTop: 14, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', padding: 14 }}>
          <ReviewRow label="Category" value={category} onEdit={() => setStep(1)} />
          <ReviewRow label="Title" value={title} onEdit={() => setStep(2)} />
          <ReviewRow label="Description" value={description} onEdit={() => setStep(2)} />
          <ReviewRow label="Budget" value={`GHS ${Number(budget || 0).toFixed(2)}`} onEdit={() => setStep(2)} />
          <ReviewRow label="Date" value={preferredDate} onEdit={() => setStep(2)} />
          <ReviewRow
            label="Location"
            value={`${area}${pickedCoords ? ` (${pickedCoords.latitude.toFixed(5)}, ${pickedCoords.longitude.toFixed(5)})` : ''}`}
            onEdit={() => setStep(3)}
          />
          <Text style={{ marginTop: 10, color: '#334155', fontWeight: '700' }}>ConnectHub charges 10% on completed jobs</Text>

          <TouchableOpacity
            onPress={handlePost}
            disabled={isSubmitting}
            style={{
              marginTop: 16,
              height: 52,
              borderRadius: 12,
              backgroundColor: '#2563eb',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {isSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>Post Job</Text>}
          </TouchableOpacity>
        </View>
      ) : null}

      {step < 4 ? (
        <View style={{ marginTop: 18 }}>
          {step > 1 ? (
            <TouchableOpacity onPress={() => setStep((prev) => prev - 1)} style={{ marginBottom: 10, alignItems: 'center', paddingVertical: 12 }}>
              <Text style={{ color: '#334155', fontWeight: '800' }}>Back</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            onPress={() => setStep((prev) => prev + 1)}
            disabled={(step === 1 && !step1Valid) || (step === 2 && !step2Valid) || (step === 3 && !step3Valid)}
            style={{
              borderRadius: 12,
              paddingVertical: 15,
              alignItems: 'center',
              backgroundColor: ((step === 1 && step1Valid) || (step === 2 && step2Valid) || (step === 3 && step3Valid)) ? '#2563eb' : '#94a3b8',
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '900' }}>Next</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Field({ label, value, onChangeText, placeholder, keyboardType, multiline, height, prefix }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ color: '#0f172a', fontWeight: '700', marginBottom: 6 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, backgroundColor: '#fff' }}>
        {prefix ? <Text style={{ paddingLeft: 12, color: '#334155', fontWeight: '700' }}>{prefix}</Text> : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          keyboardType={keyboardType}
          multiline={multiline}
          style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 12, minHeight: height || 46, textAlignVertical: multiline ? 'top' : 'center' }}
        />
      </View>
    </View>
  );
}

function ErrorText({ text }) {
  return <Text style={{ color: '#b91c1c', fontSize: 12, marginBottom: 8 }}>{text}</Text>;
}

function ReviewRow({ label, value, onEdit }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
      <Text style={{ width: 90, color: '#64748b', fontWeight: '700' }}>{label}</Text>
      <Text style={{ flex: 1, color: '#0f172a' }} numberOfLines={2}>{value}</Text>
      <TouchableOpacity onPress={onEdit} style={{ marginLeft: 8 }}>
        <Text style={{ color: '#2563eb', fontWeight: '900' }}>✏️</Text>
      </TouchableOpacity>
    </View>
  );
}
