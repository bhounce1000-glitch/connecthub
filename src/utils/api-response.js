export async function readApiResponse(response) {
  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  const requestId = data?.requestId || response.headers.get('x-request-id') || null;

  if (requestId && !data?.requestId) {
    return {
      ...data,
      requestId,
    };
  }

  return data;
}

export function formatApiMessage(payload, fallbackMessage) {
  const message = payload?.message || payload?.error || fallbackMessage;
  const requestId = payload?.requestId;

  if (!requestId) {
    return message;
  }

  return `${message}\n\nRequest ID: ${requestId}`;
}