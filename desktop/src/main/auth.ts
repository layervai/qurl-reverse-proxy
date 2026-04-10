import { shell, safeStorage } from 'electron';
import http from 'http';
import crypto from 'crypto';
import { URL } from 'url';

// Environment-aware Auth0 configuration
interface AuthConfig {
  domain: string;
  clientId: string;
  audience: string;
  redirectPort: number;
}

// Auth0 configuration per environment.
// Production uses the shared tenant (auth.layerv.ai).
// Staging uses a dedicated dev tenant for isolation.
const AUTH_CONFIGS: Record<string, AuthConfig> = {
  production: {
    domain: 'auth.layerv.ai',
    clientId: process.env.QURL_AUTH0_CLIENT_ID || '', // TODO: Register Native app in prod tenant
    audience: 'https://api.layerv.ai',
    redirectPort: 19836,
  },
  staging: {
    domain: 'dev-q1kiedn8knbutena.us.auth0.com',
    clientId: 'hRIdH8XZrWwKdQXzqIG4Csyq2IdZf9OF',
    audience: 'https://api.layerv.xyz',
    redirectPort: 19836,
  },
};

interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number;
  email?: string;
  environment: string;
  /** When true, accessToken is an API key (lv_live_ / lv_test_ prefixed). */
  isAPIKey?: boolean;
  /** Masked display hint for the API key, e.g. "lv_live_...a3f2". */
  apiKeyHint?: string;
}

let currentTokens: AuthTokens | null = null;

function getConfig(): AuthConfig {
  const env = process.env.QURL_ENV || 'production';
  return AUTH_CONFIGS[env] || AUTH_CONFIGS.production;
}

export function getEnvironment(): string {
  return process.env.QURL_ENV || 'production';
}

/**
 * Start the browser-based OAuth login flow.
 * Opens the system browser to Auth0, listens on a local port for the callback.
 */
export async function signIn(): Promise<AuthTokens> {
  const config = getConfig();

  if (!config.clientId) {
    throw new Error(
      `Auth0 client ID not configured for ${getEnvironment()} environment.\n` +
      'Set QURL_AUTH0_CLIENT_ID environment variable or configure in Settings.'
    );
  }

  const state = crypto.randomBytes(16).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  const redirectUri = `http://127.0.0.1:${config.redirectPort}/callback`;

  const authUrl = new URL(`https://${config.domain}/authorize`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', config.clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'openid profile email offline_access');
  // Only include audience if configured — dev tenants may not have an API registered
  if (config.audience) {
    authUrl.searchParams.set('audience', config.audience);
  }
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  // Start a local HTTP server to catch the callback
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://127.0.0.1:${config.redirectPort}`);

      if (url.pathname === '/callback') {
        const returnedState = url.searchParams.get('state');
        const authCode = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body style="font-family:system-ui;text-align:center;padding:60px;background:#0a0e27;color:#e0e0e0"><h2>Sign-in failed</h2><p>You can close this tab.</p></body></html>');
          server.close();
          reject(new Error(`Auth0 error: ${error}`));
          return;
        }

        if (returnedState !== state || !authCode) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body style="font-family:system-ui;text-align:center;padding:60px;background:#0a0e27;color:#e0e0e0"><h2>Invalid response</h2><p>You can close this tab.</p></body></html>');
          server.close();
          reject(new Error('Invalid state or missing authorization code'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body style="font-family:system-ui;text-align:center;padding:60px;background:#0a0e27;color:#e0e0e0"><h2 style="color:#4facfe">Signed in!</h2><p>You can close this tab and return to the app.</p></body></html>');
        server.close();
        resolve(authCode);
      }
    });

    server.listen(config.redirectPort, '127.0.0.1', () => {
      shell.openExternal(authUrl.toString());
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Sign-in timed out. Please try again.'));
    }, 120_000);
  });

  // Exchange code for tokens
  const tokenResponse = await fetch(`https://${config.domain}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      code,
      redirect_uri: `http://127.0.0.1:${config.redirectPort}/callback`,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${body}`);
  }

  const tokenData = await tokenResponse.json() as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in: number;
  };

  currentTokens = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    idToken: tokenData.id_token,
    expiresAt: Date.now() + tokenData.expires_in * 1000,
    environment: getEnvironment(),
  };

  // Decode email from ID token if present
  if (tokenData.id_token) {
    try {
      const payload = JSON.parse(
        Buffer.from(tokenData.id_token.split('.')[1], 'base64').toString()
      );
      currentTokens.email = payload.email;
    } catch {
      // Ignore decode errors
    }
  }

  // Persist encrypted tokens
  persistTokens(currentTokens);

  return currentTokens;
}

// API base URLs per environment, used for API key validation.
// Matches infrastructure: staging = api.layerv.xyz, production = api.layerv.ai
const API_BASE_URLS: Record<string, string> = {
  production: 'https://api.layerv.ai/v1',
  staging: 'https://api.layerv.xyz/v1',
};

/**
 * Validate and store an API key.
 *
 * The key prefix determines the environment:
 *   lv_live_ -> production
 *   lv_test_ -> staging
 *
 * Validates the key by calling the QURL health endpoint with it as a Bearer
 * token. On success the key is stored encrypted, the same as OAuth tokens.
 */
export async function signInWithAPIKey(apiKey: string): Promise<AuthTokens> {
  if (!apiKey.startsWith('lv_live_') && !apiKey.startsWith('lv_test_')) {
    throw new Error(
      'Invalid API key format. Keys must start with lv_live_ or lv_test_.'
    );
  }

  // If QURL_ENV is explicitly set, use that instead of inferring from key prefix.
  // This handles the case where staging portals issue lv_live_ prefixed keys.
  const envOverride = getEnvironment();
  let env: string;
  if (envOverride !== 'production') {
    env = envOverride;
  } else if (apiKey.startsWith('lv_test_')) {
    env = 'staging';
  } else {
    env = 'production';
  }

  const baseURL = API_BASE_URLS[env];

  // Validate the key by calling an actual authenticated endpoint.
  // /health doesn't require auth, so we use /v1/resources?limit=1 instead.
  const resp = await fetch(`${baseURL}/resources?limit=1`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      throw new Error('API key is invalid or revoked. Please check your key in the LayerV portal.');
    }
    throw new Error(`API validation failed (HTTP ${resp.status}). Please try again.`);
  }

  // Fetch user identity from /v1/me (works with API key auth).
  let email: string | undefined;
  try {
    const meResp = await fetch(`${baseURL}/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (meResp.ok) {
      const meData = await meResp.json();
      email = meData?.data?.email || undefined;
    }
  } catch {
    // Non-fatal — fall back to masked key hint below.
  }

  // Build a masked hint for display: "lv_live_...a3f2"
  const prefix = apiKey.slice(0, 8); // "lv_live_" or "lv_test_"
  const suffix = apiKey.slice(-4);
  const hint = `${prefix}...${suffix}`;

  currentTokens = {
    accessToken: apiKey,
    // API keys don't expire on the client side; set a far-future expiry so
    // getTokens() doesn't discard them. The server enforces actual expiry.
    expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
    environment: env,
    isAPIKey: true,
    apiKeyHint: hint,
    email,
  };

  persistTokens(currentTokens);
  return currentTokens;
}

export function signOut(): void {
  currentTokens = null;
  clearPersistedTokens();
}

export function getTokens(): AuthTokens | null {
  if (currentTokens && currentTokens.expiresAt > Date.now()) {
    return currentTokens;
  }
  // Try loading from disk
  const loaded = loadPersistedTokens();
  if (loaded && loaded.expiresAt > Date.now()) {
    currentTokens = loaded;
    return loaded;
  }
  // API keys persisted in an older format may lack expiresAt; accept them
  // if the isAPIKey flag is set.
  if (loaded && loaded.isAPIKey) {
    currentTokens = loaded;
    return loaded;
  }
  return null;
}

export function isSignedIn(): boolean {
  return getTokens() !== null;
}

// --- Token persistence using Electron's safeStorage ---

function persistTokens(tokens: AuthTokens): void {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const data = JSON.stringify(tokens);
      const encrypted = safeStorage.encryptString(data);
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const dir = path.join(os.homedir(), '.qurl');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '.auth'), encrypted);
    }
  } catch {
    // Silent fail — tokens won't persist across restarts
  }
}

function loadPersistedTokens(): AuthTokens | null {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const filePath = path.join(os.homedir(), '.qurl', '.auth');
      if (fs.existsSync(filePath)) {
        const encrypted = fs.readFileSync(filePath);
        const decrypted = safeStorage.decryptString(encrypted);
        return JSON.parse(decrypted);
      }
    }
  } catch {
    // Corrupt or unreadable — ignore
  }
  return null;
}

function clearPersistedTokens(): void {
  try {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const filePath = path.join(os.homedir(), '.qurl', '.auth');
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // Ignore
  }
}
