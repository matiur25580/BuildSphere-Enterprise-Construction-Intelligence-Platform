# Authentication API

Base path: `/api/v1/auth`

All responses use JSON. Authentication errors return a non-2xx status and a `message`.

## Register

`POST /register`

Request:

```json
{
  "name": "Alex Morgan",
  "email": "alex@example.com",
  "password": "a-long-password-12",
  "organizationName": "Northstar Construction"
}
```

Creates a user, organization, and owner membership. Returns an access token and sets the refresh token in an HttpOnly cookie.

## Login

`POST /login`

Request: `{ "email": "alex@example.com", "password": "..." }`

Returns an access token and sets the refresh cookie.

## Refresh

`POST /refresh`

Requires the refresh cookie. Revokes the presented refresh session and rotates it to a new cookie. Returns a new access token.

## Logout

`POST /logout`

Revokes the refresh session when present and clears the refresh cookie.

## Current user

`GET /me`

Requires `Authorization: Bearer <access-token>`. Returns the authenticated user and active organization membership.

## Token lifecycle

- Access token lifetime: 15 minutes.
- Refresh session lifetime: 30 days.
- Refresh tokens are random opaque values; only SHA-256 hashes are stored.
- Refresh tokens are delivered only in an HttpOnly, SameSite=Strict cookie.
- Access tokens are held in frontend memory and sent using the Authorization header.
- Authentication endpoints are rate-limited.

## Current scope

Email verification, password reset delivery, MFA, organization switching, and administrative membership management are not implemented yet. They must be added before production deployment.
