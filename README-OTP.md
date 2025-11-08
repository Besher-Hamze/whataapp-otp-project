## OTP API (API Key Auth) — Quick Guide

Simple docs for frontend/mobile engineers to send and verify OTP via WhatsApp using an API key.

- Base URL: `https://otp.anycode-sy.com`
- Auth: include your API key in header `x-api-key: <YOUR_API_KEY>`
- OTP validity: 5 minutes

### 1) Send OTP

- Method: POST
- Path: `/auth/send-otp`
- Headers:
  - `Content-Type: application/json`
  - `x-api-key: <YOUR_API_KEY>`
- Body (JSON):
  - `phone_number` (string)
  - `otp` (string) — the code to send (e.g., 6 digits)

Curl

```bash
curl -X POST https://otp.anycode-sy.com/auth/send-otp \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"phone_number":"+12345550123","otp":"123456"}'
```

Example response

```json
{ "message": "OTP sent successfully" }
```

JS/TS (fetch)

```typescript
await fetch('https://otp.anycode-sy.com/auth/send-otp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'YOUR_API_KEY',
  },
  body: JSON.stringify({ phone_number: '+12345550123', otp: '123456' }),
});
```

Common errors

- 400: "Phone number and OTP are required"
- 400: "No WhatsApp account found for this user"
- 400: "Failed to send OTP: <reason>"
- 401: "API key is missing" or "Invalid API key"

### 2) Verify OTP

- Method: POST
- Path: `/auth/verify-otp`
- Headers:
  - `Content-Type: application/json`
  - `x-api-key: <YOUR_API_KEY>`
- Body (JSON):
  - `phone_number` (string)
  - `otp` (string)

Curl

```bash
curl -X POST https://otp.anycode-sy.com/auth/verify-otp \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"phone_number":"+12345550123","otp":"123456"}'
```

Example response (success)

```json
{ "message": "OTP verified succesfully!!", "success": true }
```

JS/TS (fetch)

```typescript
const res = await fetch('https://otp.anycode-sy.com/auth/verify-otp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'YOUR_API_KEY',
  },
  body: JSON.stringify({ phone_number: '+12345550123', otp: '123456' }),
});
const data = await res.json();
// data.success === true when verified
```

Common errors

- 400: "Phone number and OTP are required"
- 400: "Invalid OTP"
- 400: "OTP has expired"
- 401: "API key is missing" or "Invalid API key"

### Notes

- Frontend/mobile apps only need the API key. Provision it from backend once using your authenticated flow (`POST /auth/generate-api-key`).
- OTPs are stored and automatically expire after 5 minutes.
- Phone format must match your WhatsApp integration expectations (E.164 recommended).
