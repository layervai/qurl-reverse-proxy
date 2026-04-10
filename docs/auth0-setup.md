# Auth0 Setup for Desktop App Browser Sign-In

The desktop app supports two sign-in methods:
- **API Key** — works immediately, no Auth0 setup needed
- **Browser sign-in** — OAuth2 PKCE flow via Auth0, requires a Native Application registered in the tenant

Browser sign-in currently works for **staging** (`QURL_ENV=staging`) out of the box. For **production**, you need to register a Native Application in the production Auth0 tenant.

## How It Works

1. User clicks "Sign in with browser"
2. App opens system browser to Auth0 `/authorize` endpoint
3. User authenticates in browser
4. Auth0 redirects to `http://127.0.0.1:19836/callback` with an authorization code
5. App exchanges the code for tokens via PKCE (no client secret needed)
6. Access token is stored encrypted at `~/.qurl/.auth`

## Current State

| Environment | Auth0 Domain | Client ID | Status |
|-------------|-------------|-----------|--------|
| Staging | `dev-q1kiedn8knbutena.us.auth0.com` | `hRIdH8XZrWwKdQXzqIG4Csyq2IdZf9OF` | Working |
| Production | `auth.layerv.ai` | Not configured | Needs setup |

## Setting Up the Staging Tenant (Already Done)

The staging tenant at `dev-q1kiedn8knbutena.us.auth0.com` already has a Native Application configured. To use it:

```bash
QURL_ENV=staging npm run start
```

No further setup needed for staging.

## Setting Up the Production Tenant

### Step 1: Create a Native Application in Auth0

1. Go to [Auth0 Dashboard](https://manage.auth0.com/) for the production tenant (`auth.layerv.ai`)
2. Navigate to **Applications** > **Create Application**
3. Choose:
   - **Name**: `QURL Desktop`
   - **Type**: `Native`
4. Click **Create**

### Step 2: Configure the Application

In the application settings:

| Setting | Value |
|---------|-------|
| **Allowed Callback URLs** | `http://127.0.0.1:19836/callback` |
| **Allowed Logout URLs** | `http://127.0.0.1:19836` |
| **Allowed Web Origins** | (leave empty) |
| **Token Endpoint Authentication Method** | `None` (PKCE doesn't use client secrets) |
| **Application Type** | `Native` |
| **Grant Types** | `Authorization Code` (with PKCE) |

### Step 3: Configure the API Audience

Ensure the Auth0 API is configured:

1. Go to **APIs** in the Auth0 dashboard
2. There should be an API with identifier `https://api.layerv.ai`
3. If not, create one:
   - **Name**: `QURL API`
   - **Identifier**: `https://api.layerv.ai`
   - **Signing Algorithm**: `RS256`

### Step 4: Update the Desktop App

Copy the **Client ID** from the application settings and either:

**Option A: Environment variable** (for dev/testing):
```bash
QURL_AUTH0_CLIENT_ID=<your-client-id> npm run start
```

**Option B: Hardcode in source** (for distribution):

Edit `desktop/src/main/auth.ts`, line 20:
```typescript
production: {
    domain: 'auth.layerv.ai',
    clientId: '<your-client-id>',  // Replace this
    audience: 'https://api.layerv.ai',
    redirectPort: 19836,
},
```

### Step 5: Verify

```bash
npm run build && npm run start
```

Click "Sign in with browser" — should open Auth0 login page, redirect back, and show your email in the sidebar.

## OAuth Scopes Requested

The app requests these scopes:
- `openid` — required for OIDC
- `profile` — user's name
- `email` — user's email (displayed in sidebar)
- `offline_access` — refresh token for persistent sessions

## Token Storage

- Tokens are encrypted using Electron's `safeStorage` API (OS keychain)
- Stored at `~/.qurl/.auth`
- Cleared on sign-out
- API keys are stored the same way (with `isAPIKey: true` flag)

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| "Auth0 client ID not configured" | Missing client ID for the environment | Set `QURL_AUTH0_CLIENT_ID` env var or hardcode it |
| Browser opens but login fails | Callback URL not whitelisted | Add `http://127.0.0.1:19836/callback` to Allowed Callback URLs in Auth0 |
| "Sign-in timed out" | User didn't complete login within 2 minutes | Try again, check browser didn't block the popup |
| Token works for login but API calls fail | Audience not configured | Ensure the API identifier matches `https://api.layerv.ai` in Auth0 |
| Works on staging but not production | Different tenant config | Each tenant needs its own Native Application with the correct callback URLs |
