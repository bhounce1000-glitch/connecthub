/* eslint-disable no-console */

(async () => {
  const baseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
  const fetchFn = global.fetch
    ? global.fetch.bind(global)
    : (await import('node-fetch')).default;

  const checks = [];

  async function runCheck(name, handler) {
    try {
      await handler();
      checks.push({ name, ok: true });
      console.log(`PASS: ${name}`);
    } catch (error) {
      checks.push({ name, ok: false, reason: error.message || String(error) });
      console.log(`FAIL: ${name} -> ${error.message || error}`);
    }
  }

  await runCheck('GET / health responds with success payload', async () => {
    const response = await fetchFn(`${baseUrl}/`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Expected 2xx, received ${response.status}`);
    }

    if (!data?.status) {
      throw new Error('Expected status=true in health payload');
    }
  });

  await runCheck('POST /pay rejects unauthenticated request with 401', async () => {
    const response = await fetchFn(`${baseUrl}/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const data = await response.json().catch(() => ({}));

    if (response.status !== 401) {
      throw new Error(`Expected 401, received ${response.status}`);
    }

    if (data?.code !== 'missing_bearer_token') {
      throw new Error(`Expected code=missing_bearer_token, received ${data?.code || 'unknown'}`);
    }
  });

  await runCheck('POST /pay/verify rejects unauthenticated request with 401', async () => {
    const response = await fetchFn(`${baseUrl}/pay/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const data = await response.json().catch(() => ({}));

    if (response.status !== 401) {
      throw new Error(`Expected 401, received ${response.status}`);
    }

    if (data?.code !== 'missing_bearer_token') {
      throw new Error(`Expected code=missing_bearer_token, received ${data?.code || 'unknown'}`);
    }
  });

  const failedChecks = checks.filter((item) => !item.ok);

  console.log('');
  console.log(`Completed ${checks.length} checks. Passed: ${checks.length - failedChecks.length}. Failed: ${failedChecks.length}.`);

  if (failedChecks.length > 0) {
    process.exitCode = 1;
  }
})();
