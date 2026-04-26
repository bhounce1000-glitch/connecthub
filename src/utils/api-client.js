import { auth } from '../firebase';
import { formatApiMessage, readApiResponse } from './api-response';

export async function apiFetch(url, options = {}) {
  const { requireAuth = false, headers: originalHeaders = {}, ...restOptions } = options;
  const headers = {
    ...originalHeaders,
  };

  if (requireAuth) {
    const token = await auth.currentUser?.getIdToken(true);

    if (!token) {
      throw new Error('You are not authenticated');
    }

    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...restOptions,
    headers,
  });
  const data = await readApiResponse(response);

  return {
    response,
    data,
  };
}

export function apiGet(url, options = {}) {
  return apiFetch(url, {
    ...options,
    method: 'GET',
  });
}

export function apiPost(url, body, options = {}) {
  const { headers = {}, ...restOptions } = options;

  return apiFetch(url, {
    ...restOptions,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

export function apiDelete(url, options = {}) {
  return apiFetch(url, {
    ...options,
    method: 'DELETE',
  });
}

export function assertApiSuccess(response, data, fallbackMessage) {
  if (!response.ok || !data?.status) {
    throw new Error(formatApiMessage(data, fallbackMessage));
  }

  return data;
}