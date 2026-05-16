# ConnectHub Setup

## Environment Variables

Set these in both local `.env` and Render dashboard.

| Variable | Required | Example | Purpose |
| --- | --- | --- | --- |
| `PAYSTACK_SECRET` | Yes | `sk_test_xxx` | Paystack secret for payments and transfers |
| `ENCRYPTION_KEY` | Yes | `2dd37c2fc28ca328d58109beba297b31` | Encrypt/decrypt sensitive fields |
| `ADMIN_EMAIL` | Yes | `connecthub1000@gmail.com` | Grants admin access in API routes |
| `EMAIL_USER` | Recommended | `noreply@yourdomain.com` | SMTP username for email notifications |
| `EMAIL_PASS` | Recommended | `app-password` | SMTP password or app password |
| `EMAIL_FROM` | Recommended | `ConnectHub <noreply@yourdomain.com>` | Sender name/email for system mail |
| `EXPO_PUBLIC_API_BASE_URL` | Yes (frontend) | `https://connecthub-yrox.onrender.com` | Backend API URL used by app |
| `EXPO_PUBLIC_WEB_BASE_URL` | Yes (frontend) | `https://connecthub-1873e.web.app` | Public web URL |

## Generate Encryption Key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex').slice(0,32))"
```

## Quick Verification

Run this before deployment:

```bash
node -e "require('dotenv').config(); console.log('ENCRYPTION_KEY =', process.env.ENCRYPTION_KEY)"
```

Expected: prints a non-empty 32-character key.

## OTP Storage

OTP records are now stored in Firestore collection `otp_verifications` with a 10-minute expiry and daily cleanup.

## Scaling Note

The backend `SimpleCache` is in-memory and safe for single-instance deployments. If you scale to multiple instances, migrate cache state to Redis (for example, Upstash) to avoid cache inconsistency across instances.

## Deployment Order

```bash
firebase deploy --only firestore:rules
firebase deploy --only storage
npx expo export --platform web --output-dir dist
firebase deploy --only hosting
```

## Post-Deploy Smoke Test

```bash
node scripts/smoke-api.js
```
