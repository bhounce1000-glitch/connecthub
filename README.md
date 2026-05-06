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
- `PAYSTACK_WITHDRAWALS_ENABLED`: Set to `true` only after your Paystack account supports third-party payouts and Transfers is enabled. Default should remain `false` for the current ConnectHub setup.
- `PAYSTACK_WITHDRAWALS_DISABLED_REASON`: Message shown in the withdrawal UI while payouts are disabled.
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
6. Keep `PAYSTACK_WITHDRAWALS_ENABLED=false` until your Paystack account is approved for third-party payouts and Transfers is enabled.

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
- `npm run migrate:kyc:dry`: Preview KYC status sync changes from `kyc_submissions` to `users`.
- `npm run migrate:kyc`: Apply the one-time KYC status sync.
- `npm run migrate:kyc:repair:dry`: Preview auto-repair of blank statuses and malformed doc cleanup.
- `npm run migrate:kyc:repair`: Apply auto-repair and malformed doc cleanup.

## One-time KYC backfill

Use this migration if existing users are stuck behind stale `users.kycStatus` values.

1. Run a dry run first:

   ```bash
   npm run migrate:kyc:dry
   ```

2. If the summary looks correct, run the live migration:

   ```bash
   npm run migrate:kyc
   ```

Optional: include users that are missing a `users/{email}` document.

```bash
node scripts/sync-kyc-status.js --include-missing-users
```

Optional: run with blank-status auto-repair and malformed cleanup.

```bash
node scripts/sync-kyc-status.js --auto-repair-blank-status --delete-malformed
```

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
- `GET /wallet/withdraw-status`: Returns whether wallet withdrawals are currently enabled.
- `POST /paystack/webhook`: Receives signed Paystack webhook events and updates Firestore when a charge succeeds.
- `GET /`: Simple health check.

## Wallet withdrawals

Automatic wallet withdrawals depend on Paystack transfer capability. For the current ConnectHub production setup, withdrawals should stay disabled until Paystack allows third-party payouts for the account.

To re-enable automatic withdrawals safely:

1. Upgrade the Paystack business tier so third-party payouts are allowed.
2. Enable Transfers in the Paystack dashboard.
3. Confirm the Paystack balance is funded.
4. Set `PAYSTACK_WITHDRAWALS_ENABLED=true` in Render.
5. Redeploy the backend.

## Paystack dashboard

Configure your Paystack webhook URL to point to your deployed backend:

```text
https://your-backend-host/paystack/webhook
```

For local development, the callback route used after checkout is:

```text
http://localhost:8081/pay-return
```
