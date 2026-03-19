# Auth Endpoints - Quick Reference (Request/Response Examples)

> Copy-paste these exact examples to test with tools like Postman or Insomnia

---

## 1. Register

```
POST /auth/register
Content-Type: application/json

REQUEST BODY:
{
  "email": "john@example.com",
  "password": "SecurePass123!",
  "password_confirm": "SecurePass123!",
  "display_name": "John Doe",
  "date_of_birth": "1995-05-15",
  "gender": "MALE",
  "captchaToken": "<recaptcha-token>"
}

RESPONSE (201):
{
  "message": "Registration successful. Verification email sent."
}

RESPONSE (400):
{
  "code": "WEAK_PASSWORD",
  "message": "Password must include uppercase, lowercase, number, and special character."
}

RESPONSE (409):
{
  "code": "EMAIL_ALREADY_REGISTERED",
  "message": "An account with this email already exists."
}
```

---

## 2. Verify Email

```
GET /auth/verify-email?token=eye1r7n2k9q5lx4b8vj6z3m2n0p9

RESPONSE (200):
{
  "message": "Email verified successfully."
}

RESPONSE (400):
{
  "code": "INVALID_TOKEN",
  "message": "Verification token is invalid or expired."
}
```

---

## 3. Resend Verification

```
POST /auth/resend-verification
Content-Type: application/json

REQUEST BODY:
{
  "email": "john@example.com"
}

RESPONSE (200):
{
  "message": "If an account exists with this email and is unverified, a verification email has been sent."
}

RESPONSE (429):
{
  "code": "RATE_LIMIT",
  "message": "Too many requests. Try again later.",
  "retryAfter": 3600
}
```

---

## 4. Login

```
POST /auth/login
Content-Type: application/json
Credentials: include

REQUEST BODY:
{
  "email": "john@example.com",
  "password": "SecurePass123!",
  "rememberMe": false
}

RESPONSE (200, cookies set):
Set-Cookie: access_token=...; HttpOnly; Secure; SameSite=None
Set-Cookie: refresh_token=...; HttpOnly; Secure; SameSite=None

{
  "message": "Login successful.",
  "user": {
    "id": "user-uuid-123",
    "email": "john@example.com",
    "displayName": "John Doe"
  }
}

RESPONSE (401):
{
  "code": "INVALID_CREDENTIALS",
  "message": "Invalid email or password."
}

RESPONSE (401):
{
  "code": "EMAIL_NOT_VERIFIED",
  "message": "Email not verified. Check your inbox for verification link."
}

RESPONSE (429):
{
  "code": "RATE_LIMIT",
  "message": "Too many login attempts. Try again later."
}
```

---

## 5. Forgot Password

```
POST /auth/forgot-password
Content-Type: application/json

REQUEST BODY:
{
  "email": "john@example.com"
}

RESPONSE (200):
{
  "message": "If an account with this email exists, a password reset link has been sent."
}
```

---

## 6. Reset Password

```
POST /auth/reset-password
Content-Type: application/json

REQUEST BODY:
{
  "token": "pwr_eye1r7n2k9q5lx4b8vj6z3m2n0p9",
  "newPassword": "NewPass456!"
}

RESPONSE (200):
{
  "message": "Password reset successful. All sessions have been revoked. Please login again."
}

RESPONSE (400):
{
  "code": "INVALID_TOKEN",
  "message": "Password reset token is invalid or expired."
}
```

---

## 7. Refresh Token

```
POST /auth/refresh
Credentials: include

RESPONSE (200, new cookies set):
Set-Cookie: access_token=<new_token>; HttpOnly; Secure; SameSite=None
Set-Cookie: refresh_token=<new_token>; HttpOnly; Secure; SameSite=None

{
  "message": "Token refreshed successfully.",
  "user": {
    "id": "user-uuid-123",
    "email": "john@example.com"
  }
}

RESPONSE (401):
{
  "code": "INVALID_REFRESH_TOKEN",
  "message": "Refresh token is missing, invalid, or expired."
}
```

---

## 8. Logout

```
POST /auth/logout
Credentials: include

RESPONSE (200, cookies cleared):
Set-Cookie: access_token=; Max-Age=0
Set-Cookie: refresh_token=; Max-Age=0

{
  "message": "Logout successful."
}
```

---

## 9. Get Sessions

```
GET /auth/sessions
Credentials: include

RESPONSE (200):
[
  {
    "id": "session-uuid-1",
    "deviceName": "Chrome on Windows",
    "lastSeenAt": "2024-01-15T10:30:00Z",
    "ipAddress": "192.168.1.100",
    "expiresAt": "2024-01-22T10:30:00Z"
  },
  {
    "id": "session-uuid-2",
    "deviceName": "Safari on iPhone",
    "lastSeenAt": "2024-01-14T15:45:00Z",
    "ipAddress": "203.0.113.42",
    "expiresAt": "2024-01-21T15:45:00Z"
  }
]

RESPONSE (401):
{
  "code": "UNAUTHORIZED",
  "message": "Not authenticated."
}
```

---

## 10. Revoke Session

```
DELETE /auth/sessions/session-uuid-1
Credentials: include

RESPONSE (200):
{
  "message": "Session revoked successfully."
}

RESPONSE (404):
{
  "code": "SESSION_NOT_FOUND",
  "message": "Session not found or does not belong to you."
}
```

---

## 11. Revoke All Sessions

```
POST /auth/sessions/revoke-all
Credentials: include

RESPONSE (200, cookies cleared):
Set-Cookie: access_token=; Max-Age=0
Set-Cookie: refresh_token=; Max-Age=0

{
  "message": "All sessions revoked successfully."
}
```

---

## 12. Change Password

```
PATCH /auth/change-password
Content-Type: application/json
Credentials: include

REQUEST BODY:
{
  "currentPassword": "OldPass123!",
  "newPassword": "NewPass456!"
}

RESPONSE (200, cookies cleared):
Set-Cookie: access_token=; Max-Age=0
Set-Cookie: refresh_token=; Max-Age=0

{
  "message": "Password changed. All sessions revoked. Please login again."
}

RESPONSE (401):
{
  "code": "INVALID_PASSWORD",
  "message": "Current password is incorrect."
}
```

---

## 13. Get Me (Current User)

```
GET /auth/me
Credentials: include

RESPONSE (200):
{
  "id": "user-uuid-123",
  "email": "john@example.com",
  "displayName": "John Doe",
  "handle": "johndoe",
  "status": "ACTIVE",
  "emailVerified": true,
  "createdAt": "2024-01-01T00:00:00Z"
}

RESPONSE (401):
{
  "code": "UNAUTHORIZED",
  "message": "Not authenticated."
}
```

---

## 14. Request Email Change

```
POST /auth/request-email-change
Content-Type: application/json
Credentials: include

REQUEST BODY:
{
  "newEmail": "newemail@example.com"
}

RESPONSE (200):
{
  "message": "Verification email sent to your new address."
}

RESPONSE (400):
{
  "code": "EMAIL_ALREADY_TAKEN",
  "message": "This email is already registered."
}
```

---

## 15. Confirm Email Change

```
POST /auth/confirm-email-change
Content-Type: application/json
Credentials: include

REQUEST BODY:
{
  "token": "eml_eye1r7n2k9q5lx4b8vj6z3m2n0p9"
}

RESPONSE (200):
{
  "message": "Email changed successfully."
}

RESPONSE (400):
{
  "code": "INVALID_TOKEN",
  "message": "Email change token is invalid or expired."
}
```

---

## 16. Google OAuth - Initiate

```
GET /auth/google

RESPONSE (302 Redirect):
Location: https://accounts.google.com/o/oauth2/v2/auth?client_id=...&redirect_uri=...
```

---

## 17. Google OAuth - Callback

```
GET /auth/google/callback?code=...[handled automatically]

RESPONSE (200, cookies set):
{
  "message": "Google login successful.",
  "user": {
    "id": "user-uuid-456",
    "email": "john@gmail.com"
  }
}
```

---

## Testing with JavaScript (Fetch API)

### Register & Login Flow

```javascript
// 1. Register
const registerRes = await fetch('/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    email: 'john@example.com',
    password: 'SecurePass123!',
    password_confirm: 'SecurePass123!',
    display_name: 'John',
    date_of_birth: '1995-05-15',
    gender: 'MALE',
    captchaToken: 'recaptcha-token'
  })
});

console.log(await registerRes.json());
// { message: "Registration successful..." }

// 2. User verifies email (from email link)
// GET /auth/verify-email?token=...

// 3. Login
const loginRes = await fetch('/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    email: 'john@example.com',
    password: 'SecurePass123!',
    rememberMe: true
  })
});

console.log(await loginRes.json());
// { message: "Login successful.", user: {...} }

// 4. Get current user
const meRes = await fetch('/auth/me', {
  credentials: 'include'
});

console.log(await meRes.json());
// { id: '...', email: 'john@example.com', ... }

// 5. Logout
const logoutRes = await fetch('/auth/logout', {
  method: 'POST',
  credentials: 'include'
});

console.log(await logoutRes.json());
// { message: "Logout successful." }
```

---

## Testing with cURL

```bash
# 1. Register
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email":"test@example.com",
    "password":"TestPass123!",
    "password_confirm":"TestPass123!",
    "display_name":"Test",
    "date_of_birth":"1995-05-15",
    "gender":"MALE",
    "captchaToken":"dummy"
  }' -c cookies.txt

# 2. Login (save cookies)
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPass123!"}' \
  -c cookies.txt

# 3. Get current user (use cookies)
curl http://localhost:3000/auth/me -b cookies.txt

# 4. Logout
curl -X POST http://localhost:3000/auth/logout -b cookies.txt
```

---

## Common Response Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created (register) |
| 400 | Bad request (validation error) |
| 401 | Unauthorized (token invalid/expired, wrong password) |
| 409 | Conflict (email already exists) |
| 429 | Too many requests (rate limited) |
| 500 | Server error |

---

## Error Handling Strategy

```javascript
async function authRequest(endpoint, options = {}) {
  const response = await fetch(endpoint, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  const data = await response.json();

  // Handle token expiration
  if (response.status === 401) {
    const refreshRes = await fetch('/auth/refresh', {
      method: 'POST',
      credentials: 'include'
    });

    if (refreshRes.ok) {
      // Retry original request
      return authRequest(endpoint, options);
    } else {
      // Need to login again
      window.location.href = '/login';
      return null;
    }
  }

  // Handle other errors
  if (!response.ok) {
    console.error(`[${response.status}] ${data.code}: ${data.message}`);
    throw new Error(data.message);
  }

  return data;
}

// Usage:
const user = await authRequest('/auth/me');
```
