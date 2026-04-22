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

## Payment config

- `PAYSTACK_SECRET`: Your Paystack secret key. This is used for transaction initialization, verification, and webhook signature validation.
- `EXPO_PUBLIC_API_BASE_URL`: Base URL the Expo app uses to call the backend.
- `EXPO_PUBLIC_WEB_BASE_URL`: Base URL the Expo web app uses for return routes.
- `PAYSTACK_CALLBACK_BASE_URL`: Base URL Paystack should redirect the browser back to after checkout.
- `BACKEND_PUBLIC_URL`: Public URL the backend should report in logs and external setup docs.
- `PORT`: Backend port. Defaults to `3001`.

## Production setup

1. Copy `.env.production.example` to your production environment and replace the placeholder domains.
2. Set `EXPO_PUBLIC_API_BASE_URL` to your deployed backend URL.
3. Set `EXPO_PUBLIC_WEB_BASE_URL` and `PAYSTACK_CALLBACK_BASE_URL` to the public web app URL that should receive checkout returns.
4. Set `BACKEND_PUBLIC_URL` to the public backend URL used for logs and operational docs.
5. Configure the Paystack dashboard webhook URL to `https://your-backend-host/paystack/webhook`.

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
