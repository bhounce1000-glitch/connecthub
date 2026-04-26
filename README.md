# ConnectHub

ConnectHub is an Expo app with a small Express backend for Paystack payment initialization, verification, and webhook handling.

## Local setup

1. Install dependencies

   ```bash
   npm install
   ```

2. Copy the example env file and fill in your Paystack key

   ```bash
   copy .env.example .env
   ```

3. Start the backend

   ```bash
   node server.js
   ```

4. Start Expo web

   ```bash
   npx expo start --web --clear
   ```

5. Run release checks

   ```bash
   npm run check:release
   ```

## Payment config

- `PAYSTACK_SECRET`: Your Paystack secret key. This is used for transaction initialization, verification, and webhook signature validation.
- `EXPO_PUBLIC_API_BASE_URL`: Base URL the Expo app uses to call the backend.
- `EXPO_PUBLIC_WEB_BASE_URL`: Base URL the Expo web app uses for return routes.
- `PAYSTACK_CALLBACK_BASE_URL`: Base URL Paystack should redirect the browser back to after checkout.
- `BACKEND_PUBLIC_URL`: Public URL the backend should report in logs and external setup docs.
- `CORS_ALLOWED_ORIGINS`: Comma-separated browser origins allowed to call the backend (for example `https://app.your-domain.com`).
- `EXPO_PUBLIC_FIREBASE_API_KEY`: Firebase web API key used by the Expo client.
- `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`: Firebase Auth domain for the Expo client.
- `EXPO_PUBLIC_FIREBASE_PROJECT_ID`: Firebase project id for Firestore/Auth usage.
- `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`: Firebase storage bucket for the Expo client.
- `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`: Firebase messaging sender id.
- `EXPO_PUBLIC_FIREBASE_APP_ID`: Firebase app id for the Expo client.
- `PORT`: Backend port. Defaults to `3001`.

## Production setup

1. Copy `.env.production.example` to your production environment and replace the placeholder domains.
2. Set `EXPO_PUBLIC_API_BASE_URL` to your deployed backend URL.
3. Set `EXPO_PUBLIC_WEB_BASE_URL` and `PAYSTACK_CALLBACK_BASE_URL` to the public web app URL that should receive checkout returns.
4. Set `BACKEND_PUBLIC_URL` to the public backend URL used for logs and operational docs.
5. Configure the Paystack dashboard webhook URL to `https://your-backend-host/paystack/webhook`.

## End-to-end payment walkthrough

Use this checklist before every release:

1. Sign in and create a new request.
2. Accept it from a provider account, start work, and mark it completed.
3. Return as the owner and open checkout from the payment screen.
4. Complete payment in Paystack and confirm redirect to `/pay-return`.
5. Verify the request is marked as paid in home and appears correctly in payments.
6. Confirm the rate-provider action appears and can be submitted.

## Regression commands

- `npm run lint`: Lint the Expo app.
- `npm run smoke:api`: Validate core backend payment endpoints and health route.
- `npm run check:release`: Run lint and API smoke checks together.

For a split deployment, a common setup is:

```text
Frontend: https://app.your-domain.com
Backend:  https://api.your-domain.com
Webhook:  https://api.your-domain.com/paystack/webhook
Callback: https://app.your-domain.com/pay-return
```

## Payment routes

- `POST /pay`: Initializes a Paystack transaction.
- `POST /pay/verify`: Verifies a Paystack reference.
- `POST /paystack/webhook`: Receives signed Paystack webhook events and updates Firestore when a charge succeeds.
- `GET /`: Simple health check.

## Paystack dashboard

Configure your Paystack webhook URL to point to your deployed backend:

```text
https://your-backend-host/paystack/webhook
```

For local development, the callback route used after checkout is:

```text
http://localhost:8081/pay-return
```
