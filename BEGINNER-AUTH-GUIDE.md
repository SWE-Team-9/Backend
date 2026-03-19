# Spotly Auth Module - Beginner's Guide

This guide explains how the authentication system works and how to use it from your frontend.

---

## How Authentication Works (Simple Explanation)

The auth system uses **JWT tokens stored in cookies** to keep users logged in:

1. **User registers** → Backend creates account and sends verification email
2. **User verifies email** → Clicks link in email to confirm they own the email
3. **User logs in** → Sends email + password → Backend creates session and sends back tokens in cookies
4. **Tokens in cookies** → Browser automatically includes them on every API request
5. **Backend validates token** → If token is valid, user is authenticated
6. **Token expires** → Use refresh token to get a new access token (automatic)
7. **User logs out** → Tokens are deleted from cookies

---

## The 17 Endpoints Explained (In Order of Use)

### Step 1: Register (Create New Account)

**Endpoint:**
```
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "MySecurePass123!",
  "password_confirm": "MySecurePass123!",
  "display_name": "John Doe",
  "date_of_birth": "1995-05-15",
  "gender": "MALE",
  "captchaToken": "<get-this-from-google-recaptcha>"
}
```

**What it does:**
- Checks if email is already registered (if yes, returns error)
- Verifies reCAPTCHA token to prevent bots
- Hashes password with Argon2 (very secure)
- Creates user account in database
- Sends verification email
- Returns success message

**Frontend example (JavaScript):**
```javascript
const response = await fetch('/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include', // Important: send cookies
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'MySecurePass123!',
    password_confirm: 'MySecurePass123!',
    display_name: 'John Doe',
    date_of_birth: '1995-05-15',
    gender: 'MALE',
    captchaToken: captchaToken
  })
});

const data = await response.json();
console.log(data.message); // "Verification email sent"
```

---

### Step 2: Verify Email (Confirm Email Ownership)

**How to get verify link:**
1. User receives email from Spotly
2. Email contains link like: `https://yourdomain.com/auth/verify-email?token=abc123xyz`
3. onClick or onLoad, extract `token` from URL and call this endpoint

**Endpoint:**
```
GET /auth/verify-email?token=<email_verification_token>
```

**What it does:**
- Checks if token is valid and not expired (24 hours)
- Marks user as verified
- Deletes the token
- Returns success

**Frontend example:**
```javascript
// Extract token from URL
const params = new URLSearchParams(window.location.search);
const token = params.get('token');

// Call verify endpoint
const response = await fetch(`/auth/verify-email?token=${token}`);
const data = await response.json();

if (response.ok) {
  console.log('Email verified! You can now login.');
} else {
  console.log('Verification failed:', data.message);
}
```

---

### Step 3: Resend Verification Email

**When to use:**
- User didn't receive the first email
- Verification email expired
- User lost the link

**Endpoint:**
```
POST /auth/resend-verification
Content-Type: application/json

{
  "email": "user@example.com"
}
```

**What it does:**
- Even if email doesn't exist, returns generic success (prevents hacker from knowing which emails are registered)
- If email exists and not verified, sends new email
- Rate limited to 3 requests per hour

**Frontend example:**
```javascript
const response = await fetch('/auth/resend-verification', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'user@example.com' })
});

// Always returns success even if email doesn't exist
console.log('Check your email for verification link');
```

---

### Step 4: Login (Sign In)

**Endpoint:**
```
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "MySecurePass123!",
  "rememberMe": false
}
```

**What it does:**
- Looks up user by email
- Compares password (using timing-safe comparison to prevent hacking)
- Checks if email is verified
- Creates session in database
- Generates access token (valid 15 minutes)
- Generates refresh token (valid 7 days, or 30 days if rememberMe = true)
- Sends tokens as httpOnly cookies
- Returns user info

**Important:** Include `credentials: 'include'` so cookies are stored.

**Frontend example:**
```javascript
const response = await fetch('/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include', // VERY IMPORTANT!
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'MySecurePass123!',
    rememberMe: true // 30-day token instead of 7 days
  })
});

const data = await response.json();
if (response.ok) {
  console.log('Logged in as:', data.user.email);
  // Cookies are automatically set by browser
} else {
  console.log('Login failed:', data.message);
}
```

---

### Step 5: Get Current User (Me)

**Endpoint:**
```
GET /auth/me
```

**What it does:**
- Reads access token from cookie
- Validates token signature
- Returns user profile

**Frontend example:**
```javascript
const response = await fetch('/auth/me', {
  credentials: 'include' // Include cookies
});

const user = await response.json();
if (response.ok) {
  console.log('Current user:', user.email, user.displayName);
} else if (response.status === 401) {
  console.log('Not logged in - tokens might have expired');
}
```

---

### Step 6: Refresh Token (Get New Access Token)

**When to use:**
- Access token is about to expire (15 minutes)
- Or when you get a 401 error from any endpoint

**Endpoint:**
```
POST /auth/refresh
```

**What it does:**
- Reads refresh token from cookie
- Validates it
- Generates new access token (15 minutes)
- Generates new refresh token (7 or 30 days) - old one is now invalid
- Sends new tokens as cookies

**Note:** No body needed - it uses cookie automatically.

**Frontend example:**
```javascript
const response = await fetch('/auth/refresh', {
  method: 'POST',
  credentials: 'include'
});

const data = await response.json();
if (response.ok) {
  console.log('Token refreshed! Still logged in.');
  // New tokens are in cookies now
} else {
  console.log('Session expired - please login again');
}
```

**Pro tip:** Refresh automatically on 401 errors:
```javascript
async function apiCall(url, options = {}) {
  let response = await fetch(url, {
    ...options,
    credentials: 'include'
  });

  if (response.status === 401) {
    // Try refreshing token
    const refreshResponse = await fetch('/auth/refresh', {
      method: 'POST',
      credentials: 'include'
    });

    if (refreshResponse.ok) {
      // Retry original request
      response = await fetch(url, {
        ...options,
        credentials: 'include'
      });
    }
  }

  return response;
}
```

---

### Step 7: List Active Sessions

**Endpoint:**
```
GET /auth/sessions
```

**What it does:**
- Returns list of all logged-in devices
- Shows device name, last seen, IP address, expiration

**Frontend example:**
```javascript
const response = await fetch('/auth/sessions', {
  credentials: 'include'
});

const sessions = await response.json();
console.log('Active sessions:');
sessions.forEach(session => {
  console.log(`- ${session.deviceName} (${session.ipAddress})`);
});
```

---

### Step 8: Revoke Specific Session

**Endpoint:**
```
DELETE /auth/sessions/<sessionId>
```

**What it does:**
- Logs out one specific device
- That device can no longer use its tokens

**Frontend example:**
```javascript
const sessionId = '...'; // From sessions list

const response = await fetch(`/auth/sessions/${sessionId}`, {
  method: 'DELETE',
  credentials: 'include'
});

if (response.ok) {
  console.log('Session revoked');
}
```

---

### Step 9: Revoke All Sessions

**Endpoint:**
```
POST /auth/sessions/revoke-all
```

**What it does:**
- Logs out ALL devices at once
- Current device is also logged out
- Clears cookies on current device

**When to use:**
- User suspects account compromise
- User wants to logout everywhere

**Frontend example:**
```javascript
const response = await fetch('/auth/sessions/revoke-all', {
  method: 'POST',
  credentials: 'include'
});

if (response.ok) {
  console.log('All sessions revoked - redirecting to login');
  window.location.href = '/login';
}
```

---

### Step 10: Logout (End Current Session)

**Endpoint:**
```
POST /auth/logout
```

**What it does:**
- Looks up current session
- Marks session as revoked
- Clears cookies on response

**Frontend example:**
```javascript
const response = await fetch('/auth/logout', {
  method: 'POST',
  credentials: 'include'
});

if (response.ok) {
  console.log('Logged out');
  window.location.href = '/login';
}
```

---

### Step 11: Change Password

**Endpoint:**
```
PATCH /auth/change-password
Content-Type: application/json

{
  "currentPassword": "OldPass123!",
  "newPassword": "NewPass456!"
}
```

**What it does:**
- Verifies current password
- Updates password
- Revokes ALL sessions (user logs out everywhere)
- Clears current device's cookies

**Frontend example:**
```javascript
const response = await fetch('/auth/change-password', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    currentPassword: 'OldPass123!',
    newPassword: 'NewPass456!'
  })
});

if (response.ok) {
  console.log('Password changed - redirecting to login');
  window.location.href = '/login';
}
```

---

### Step 12: Forgot Password (Email Recovery)

**Endpoint:**
```
POST /auth/forgot-password
Content-Type: application/json

{
  "email": "user@example.com"
}
```

**What it does:**
- Generates password reset token
- Sends email with reset link
- Returns generic success (prevents email enumeration)
- Token valid for 1 hour

**Frontend example:**
```javascript
const response = await fetch('/auth/forgot-password', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'user@example.com' })
});

// Always returns success
console.log('Check your email for password reset link');
```

---

### Step 13: Reset Password (Using Recovery Link)

**How to get reset link:**
1. User gets email from Spotly
2. Email contains link like: `https://yourdomain.com/reset-password?token=xyz123`
3. Extract `token` from URL

**Endpoint:**
```
POST /auth/reset-password
Content-Type: application/json

{
  "token": "<password_reset_token>",
  "newPassword": "NewPass456!"
}
```

**What it does:**
- Validates reset token
- Updates password
- Revokes ALL sessions
- Returns success

**Frontend example:**
```javascript
// Extract token from URL
const params = new URLSearchParams(window.location.search);
const token = params.get('token');

// Reset password
const response = await fetch('/auth/reset-password', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    token: token,
    newPassword: 'NewPass456!'
  })
});

if (response.ok) {
  console.log('Password reset! Redirecting to login');
  window.location.href = '/login';
}
```

---

### Step 14: Request Email Change

**Endpoint:**
```
POST /auth/request-email-change
Content-Type: application/json

{
  "newEmail": "newemail@example.com"
}
```

**What it does:**
- Checks if new email is available
- Generates email change token
- Sends verification email to NEW address
- Old email remains active until confirmed

**Frontend example:**
```javascript
const response = await fetch('/auth/request-email-change', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    newEmail: 'newemail@example.com'
  })
});

if (response.ok) {
  console.log('Check your new email for confirmation link');
}
```

---

### Step 15: Confirm Email Change

**Endpoint:**
```
POST /auth/confirm-email-change
Content-Type: application/json

{
  "token": "<email_change_token>"
}
```

**What it does:**
- Validates email change token
- Updates user's email address
- Returns success

**Frontend example:**
```javascript
const params = new URLSearchParams(window.location.search);
const token = params.get('token');

const response = await fetch('/auth/confirm-email-change', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({ token: token })
});

if (response.ok) {
  console.log('Email changed successfully!');
}
```

---

### Step 16 & 17: Google OAuth Login

**Endpoint 1: Initiate**
```
GET /auth/google
```

**What it does:**
- Redirects user to Google login page
- After login, Google redirects back to callback

**Frontend example:**
```html
<a href="/auth/google">Login with Google</a>
```

**Endpoint 2: Callback**
```
GET /auth/google/callback?code=...
```

**What it does:**
- Automatically handles after user authenticates with Google
- Creates or finds user account
- Issues tokens
- Redirects to frontend with tokens in cookies

---

## Common Mistakes & How to Fix Them

### ❌ Mistake 1: Forgetting `credentials: 'include'`

**Wrong:**
```javascript
fetch('/auth/me', {
  headers: { 'Content-Type': 'application/json' }
});
```

**Right:**
```javascript
fetch('/auth/me', {
  credentials: 'include' // Include cookies!
});
```

---

### ❌ Mistake 2: Not Handling 401 Errors

**Wrong:**
```javascript
const response = await fetch('/auth/me');
const user = await response.json(); // Crash if 401!
```

**Right:**
```javascript
const response = await fetch('/auth/me', {
  credentials: 'include'
});

if (response.status === 401) {
  // Token expired - refresh
  const refresh = await fetch('/auth/refresh', {
    method: 'POST',
    credentials: 'include'
  });

  if (refresh.ok) {
    // Retry original request
    return await fetch('/auth/me', { credentials: 'include' });
  } else {
    // Need to login again
    window.location.href = '/login';
  }
}

const user = await response.json();
```

---

### ❌ Mistake 3: Using Wrong Password Format

**Password must have:**
- At least 8 characters
- 1 uppercase letter (A-Z)
- 1 lowercase letter (a-z)
- 1 number (0-9)
- 1 special character (!@#$%^&*)

**Wrong:** `password123` ❌ (no uppercase, no special char)
**Right:** `MyPass123!` ✅

---

### ❌ Mistake 4: Forgetting Email Verification

**Wrong:** User registers → try logging in immediately
**Right:** Register → wait for user to click email link → then login

---

## Testing the Auth Endpoints (Using cURL)

### Test Register:
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPass123!",
    "password_confirm": "TestPass123!",
    "display_name": "Test User",
    "date_of_birth": "1995-05-15",
    "gender": "MALE",
    "captchaToken": "dummy-token"
  }'
```

### Test Login:
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{
    "email": "test@example.com",
    "password": "TestPass123!"
  }'
```

### Test Me (with cookies):
```bash
curl http://localhost:3000/auth/me -b cookies.txt
```

### Test Logout:
```bash
curl -X POST http://localhost:3000/auth/logout \
  -b cookies.txt -c cookies.txt
```

---

## Rate Limits (To Prevent Abuse)

| Endpoint | Limit | Reason |
|----------|-------|--------|
| Register | 3/min | Prevent account spam |
| Login | 10/min per IP, 5/15min per email | Prevent brute force |
| Forgot Password | 3/hour | Prevent email spam |
| Resend Verification | 3/hour | Prevent email spam |
| Email Change | 3/hour | Prevent abuse |
| Refresh Token | 30/min | Normal usage |

If you hit a rate limit, you get HTTP 429 error.

---

## Security Features (Why We Do This)

✅ **Argon2 Password Hashing** - Even if database is hacked, passwords are salted and very hard to crack
✅ **httpOnly Cookies** - JavaScript can't read tokens, preventing XSS attacks
✅ **CSRF Protection** - Tokens are securely signed
✅ **Token Rotation** - Old refresh tokens become invalid
✅ **Session Tracking** - Users can see all active logins
✅ **Email Verification** - Prevents fake accounts
✅ **Rate Limiting** - Prevents automated attacks
✅ **Timing-Safe Comparisons** - Password comparison doesn't leak timing info

---

## Troubleshooting

### Problem: "Email already registered"
**Solution:** Use a different email, or use forgot-password to recover

### Problem: "Email not verified"
**Solution:** Check your email for verification link, or use resend-verification

### Problem: "Invalid password"
**Solution:** Make sure password has uppercase, lowercase, number, and special char

### Problem: "Token expired"
**Solution:**  Refresh token using POST /auth/refresh

### Problem: "Not authenticated" (401)
**Solution:** User not logged in or session expired - need to login again

---

## Next Steps

1. Copy this guide to your frontend team
2. Use the code examples in your application
3. Test with the cURL commands above
4. Set up error handling for 401 (token refresh)
5. Add a login page that calls POST /auth/register and POST /auth/login
6. Add a session list page that calls GET /auth/sessions
7. Done! Your auth system is now fully integrated
