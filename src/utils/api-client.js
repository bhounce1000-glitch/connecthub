
import { auth } from '../firebase';
import { formatApiMessage, readApiResponse } from './api-response';

// Retry and timeout wrapper for fetch
export const fetchWithRetry = async (url, options = {}, retries = 3) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    return response;
  } catch (err) {
    clearTimeout(timeout);
    if (retries > 0) {
      console.warn('Retrying request...', retries, 'left');
      await new Promise(r => setTimeout(r, 2000));
      return fetchWithRetry(url, options, retries - 1);
    }
    throw err;
  }
};

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

  const response = await fetchWithRetry(url, {
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