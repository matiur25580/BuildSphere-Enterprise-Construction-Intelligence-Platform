# Authentication and Authorization Security

## Implemented controls

- Passwords are hashed with bcryptjs using cost factor 12.
- Registration enforces a 12-character minimum password length.
- Access tokens are signed JWTs with a 15-minute lifetime.
- Refresh tokens are generated from cryptographically secure random bytes.
- Only SHA-256 refresh-token hashes are persisted.
- Refresh sessions are rotated on use and revoked on logout.
- Refresh cookie is HttpOnly and SameSite=Strict; Secure is enabled in production.
- Authentication endpoints have a per-IP rate limit.
- Helmet security headers and credentialed, origin-restricted CORS are enabled.
- Organization ownership and membership are created server-side during registration.
- API authentication middleware derives user, organization, and role claims from the signed access token.
- Protected requests re-check that the user and organization membership are still active.

## Authorization rules

The request's organization context must come from the authenticated token and verified active membership. Never accept an organization identifier from request body or query string as proof of access. Domain services must scope every tenant-owned database operation by the authenticated organization identifier.

Use `requireRoles(...roles)` for role-gated routes, and still apply project/resource-level authorization in the relevant service.

## Operational requirements

- Generate a unique random `JWT_ACCESS_SECRET` of at least 32 characters per environment.
- Use HTTPS in production.
- Keep `apps/api/.env` out of version control.
- Configure the exact frontend origin in `CLIENT_URL`.
- Review rate limits, logging, backups, secret rotation, and incident response before launch.
- Add email verification, password reset, MFA, and refresh-token reuse detection before production rollout.

## Important limitation

This is an initial authentication milestone, not a security certification. Perform dependency audits, integration tests, penetration testing, and a deployment-specific cookie/CORS review before handling real customer data.
