import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { API_BASE_URL } from '../constants/api';
import { db } from '../firebase';

export default function Payments() {
  const [reference, setReference] = useState('');
  const [verificationResult, setVerificationResult] = useState(null);
  const [requests, setRequests] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    const paymentsQuery = query(collection(db, 'requests'), orderBy('createdAt', 'desc'), limit(20));

    return onSnapshot(paymentsQuery, (snapshot) => {
      setRequests(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
  }, []);

  const verifyReference = async () => {
    if (!reference.trim()) {
      Alert.alert('Missing reference', 'Enter a Paystack reference to verify.');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/pay/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reference: reference.trim() }),
      });

      const data = await response.json();
      setVerificationResult(data);
    } catch (error) {
      Alert.alert('Verification failed', error.message || 'Unable to verify this reference.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredRequests = requests.filter((item) => {
    const matchesStatus =
      statusFilter === 'all'
        ? true
        : statusFilter === 'paid'
          ? Boolean(item.paid)
          : statusFilter === 'unpaid'
            ? !item.paid
            : (item.paymentStatus || '').toLowerCase() === statusFilter;

    if (!matchesStatus) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const haystack = [
      item.id,
      item.title,
      item.paymentReference,
      item.paymentStatus,
      item.gatewayResponse,
      item.user,
      item.acceptedBy,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });

  const filterOptions = [
    { key: 'all', label: 'All' },
    { key: 'paid', label: 'Paid' },
    { key: 'unpaid', label: 'Unpaid' },
    { key: 'success', label: 'Success' },
    { key: 'abandoned', label: 'Abandoned' },
    { key: 'pending', label: 'Pending' },
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f4f6f8' }} contentContainerStyle={{ padding: 20 }}>
      <Text style={{ fontSize: 28, fontWeight: '700', marginBottom: 8 }}>
        Payments Debug
      </Text>

      <Text style={{ color: '#4b5563', marginBottom: 20 }}>
        Verify a Paystack reference and inspect recent request payment fields.
      </Text>

      <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 14, marginBottom: 20 }}>
        <Text style={{ fontWeight: '600', marginBottom: 8 }}>
          Search requests
        </Text>

        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search by title, request ID, reference, or email"
          autoCapitalize="none"
          style={{ borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, padding: 12, marginBottom: 12 }}
        />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {filterOptions.map((option) => (
            <TouchableOpacity
              key={option.key}
              style={{
                backgroundColor: statusFilter === option.key ? '#2563eb' : '#e5e7eb',
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 999,
                marginRight: 8,
                marginBottom: 8,
              }}
              onPress={() => setStatusFilter(option.key)}
            >
              <Text style={{ color: statusFilter === option.key ? 'white' : '#111827', fontWeight: '600' }}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 14, marginBottom: 20 }}>
        <Text style={{ fontWeight: '600', marginBottom: 8 }}>
          Verify reference
        </Text>

        <TextInput
          value={reference}
          onChangeText={setReference}
          placeholder="Enter Paystack reference"
          autoCapitalize="none"
          style={{ borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, padding: 12, marginBottom: 12 }}
        />

        <TouchableOpacity
          style={{
            backgroundColor: isSubmitting ? '#9ca3af' : '#2563eb',
            padding: 12,
            borderRadius: 10,
          }}
          onPress={verifyReference}
          disabled={isSubmitting}
        >
          <Text style={{ color: 'white', textAlign: 'center', fontWeight: '700' }}>
            {isSubmitting ? 'Verifying...' : 'Verify Payment'}
          </Text>
        </TouchableOpacity>

        {verificationResult ? (
          <View style={{ marginTop: 14, backgroundColor: '#f9fafb', padding: 12, borderRadius: 10 }}>
            <Text style={{ fontWeight: '700', marginBottom: 6 }}>
              Result
            </Text>
            <Text>Status: {String(verificationResult?.data?.status || verificationResult?.status || 'unknown')}</Text>
            <Text>Message: {verificationResult?.message || verificationResult?.error || 'Unavailable'}</Text>
            <Text>Reference: {verificationResult?.data?.reference || 'Unavailable'}</Text>
            <Text>Request ID: {verificationResult?.data?.metadata?.requestId || 'Unavailable'}</Text>
          </View>
        ) : null}
      </View>

      <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 12 }}>
        Recent requests ({filteredRequests.length})
      </Text>

      {filteredRequests.map((item) => (
        <View
          key={item.id}
          style={{ backgroundColor: 'white', padding: 16, borderRadius: 14, marginBottom: 12 }}
        >
          <Text style={{ fontWeight: '700', fontSize: 16, marginBottom: 6 }}>
            {item.title || item.id}
          </Text>
          <Text>ID: {item.id}</Text>
          <Text>Paid: {item.paid ? 'Yes' : 'No'}</Text>
          <Text>Payment status: {item.paymentStatus || 'Unavailable'}</Text>
          <Text>Reference: {item.paymentReference || 'Unavailable'}</Text>
          <Text>Channel: {item.paymentChannel || 'Unavailable'}</Text>
          <Text>Gateway: {item.gatewayResponse || 'Unavailable'}</Text>
          <Text>User: {item.user || 'Unavailable'}</Text>
          <Text>Accepted by: {item.acceptedBy || 'Unavailable'}</Text>
          <Text>Paid at: {item.paidAt || 'Unavailable'}</Text>
        </View>
      ))}

      {!filteredRequests.length ? (
        <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 14 }}>
          <Text style={{ color: '#4b5563' }}>
            No requests matched the current search or filter.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}