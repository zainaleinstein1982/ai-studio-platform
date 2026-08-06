import type { AuthConfig } from "convex/server";

// Freebuff-signed federated tokens (see freebuff web's
// src/lib/vly-convex-jwt.ts) let a signed-in freebuff.com user carry their
// identity into this project without going through local sign-in. customJwt
// is correct for this provider: freebuff's tokens and JWKS both carry a
// `kid` header, which the customJwt validation path requires.
const freebuffIssuer =
  process.env.VLY_CONVEX_AUTH_ISSUER ?? "https://freebuff.com";

// STEP 02 · OAuth providers (Google / GitHub).
//
// These activate automatically once the user adds the matching secrets via
// the project's API Keys / env vars:
//   - AUTH_GOOGLE_ID + AUTH_GOOGLE_SECRET  → signIn("google")
//   - AUTH_GITHUB_ID + AUTH_GITHUB_SECRET  → signIn("github")
// OAuth client credentials are read from the deployment environment, so the
// providers are only registered when the keys are present. The `?? sentinel`
// keeps the Convex CLI happy (it rejects env vars referenced-but-unset in
// auth config files); the sentinel is deliberately not a valid credential.
// STEP 02 · OAuth providers (Google / GitHub).
//
// Credentials come from deployment env vars; the Convex CLI injects them
// automatically when set:
//   - AUTH_GOOGLE_ID + AUTH_GOOGLE_SECRET → signIn("google")
//   - AUTH_GITHUB_ID + AUTH_GITHUB_SECRET → signIn("github")
// Until those are set the providers are registered but inert, and the
// client-side buttons surface a friendly "not configured" message.

export default {
  providers: [
    // Standard Convex Auth provider for this project's own sign-in (email /
    // password / guest, see src/convex/auth.ts). The deployment self-issues
    // JWTs (iss = CONVEX_SITE_URL, no `kid` header) validated via OIDC
    // discovery at `${domain}/.well-known/openid-configuration`, served by
    // auth.addHttpRoutes() in convex/http.ts. Do NOT convert this entry to
    // `type: "customJwt"` — that path rejects tokens without a `kid` header,
    // so sign-in would silently never confirm and RequireAuth would loop
    // back to /auth forever.
    {
      domain: process.env.CONVEX_SITE_URL!,
      applicationID: "convex",
    },
    {
      type: "customJwt",
      issuer: freebuffIssuer,
      jwks: `${freebuffIssuer}/api/web/.well-known/jwks.json`,
      applicationID: "vly-convex",
      algorithm: "RS256",
    },
    {
      domain: "accounts.google.com",
      applicationID: "convex",
    },
    {
      domain: "github.com",
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
