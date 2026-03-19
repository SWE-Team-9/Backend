#!/bin/bash
# Auth Module Endpoints - Simple Testing Commands
# Copy and paste these commands to test each endpoint
# Assumes backend is running on http://localhost:3000

echo "=== Spotly Auth Module - Endpoint Testing ==="
echo ""

# 1. REGISTER
echo "1. Testing POST /auth/register"
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email":"newuser@example.com",
    "password":"TestPass123!",
    "password_confirm":"TestPass123!",
    "display_name":"Test User",
    "date_of_birth":"1995-05-15",
    "gender":"MALE",
    "captchaToken":"dummy-token"
  }' -c cookies.txt
echo ""
echo ""

# 2. LOGIN
echo "2. Testing POST /auth/login"
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{
    "email":"newuser@example.com",
    "password":"TestPass123!"
  }'
echo ""
echo ""

# 3. GET CURRENT USER
echo "3. Testing GET /auth/me"
curl -X GET http://localhost:3000/auth/me \
  -b cookies.txt
echo ""
echo ""

# 4. GET SESSIONS
echo "4. Testing GET /auth/sessions"
curl -X GET http://localhost:3000/auth/sessions \
  -b cookies.txt
echo ""
echo ""

# 5. FORGOT PASSWORD
echo "5. Testing POST /auth/forgot-password"
curl -X POST http://localhost:3000/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"newuser@example.com"}'
echo ""
echo ""

# 6. REFRESH TOKEN
echo "6. Testing POST /auth/refresh"
curl -X POST http://localhost:3000/auth/refresh \
  -b cookies.txt
echo ""
echo ""

# 7. LOGOUT
echo "7. Testing POST /auth/logout"
curl -X POST http://localhost:3000/auth/logout \
  -b cookies.txt
echo ""
echo ""

echo "=== Test Complete ==="
echo ""
echo "If you see JSON responses above, all endpoints are working!"
echo "If you see 401 errors, that means the endpoint exists but needs authentication"
echo "If you see 404 errors, the endpoint doesn't exist"
