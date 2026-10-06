# #48 isolated staging session expiry

Run from the staging API environment with its existing DATABASE_URL and
AUTH_TOKEN_PEPPER. Do not paste those values, passwords or cookies into issues.
APP_ENV must be staging and WEB_URL must be https://kararver-staging.vercel.app.
The operator must verify that DATABASE_URL belongs to staging before execution.

From apps/api, first dry-run:

```sh
node src/modules/auth/staging-expiry-cli.ts --username umit_staging_48
```

Then execute the isolated acceptance:

```sh
node src/modules/auth/staging-expiry-cli.ts --username umit_staging_48 --apply
```

The command refuses elevated accounts and creates one separate 20-second session
for the existing active USER account. It does not create a user, modify roles,
change other sessions, global TTL or server clocks. This is an operator-created
session fixture, not a new login/Set-Cookie acceptance test; those flows have
separate staging evidence. No test endpoint or runtime configuration is added.

The same cookie is sent to the real Vercel proxy /api/v1/me before and after
natural expiry. Assertions require 200 with the intended user before expiry,
DB expiresAt <= DB time with revokedAt still null after expiry, then 401
UNAUTHENTICATED and cookie deletion. Token/password/connection URL are never
printed. The expired row remains as evidence and this generated session alone is
revoked during cleanup. On interruption it naturally expires within 20 seconds.

Attach the sanitized JSON output and exit code to #48. Success requires a PASS
event AND process exit code 0. Any failed phase means acceptance remains pending.
Local guard tests/typecheck are not a substitute for executing against staging.
This does not test browser redirect after expiry, physical devices, screen readers
or beta acceptance; retain their separate evidence before closing #48.
