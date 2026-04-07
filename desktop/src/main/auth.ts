import { shell, safeStorage, BrowserWindow } from 'electron';
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

const AUTH_CONFIGS: Record<string, AuthConfig> = {
  production: {
    domain: 'auth.layerv.ai',
    clientId: '', // TODO: Register desktop app in Auth0 prod tenant
    audience: 'https://api.layerv.ai',
    redirectPort: 19836,
  },
  staging: {
    domain: 'auth-staging.layerv.ai',
    clientId: '', // TODO: Register desktop app in Auth0 staging tenant
    audience: 'https://api-staging.layerv.ai',
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
  authUrl.searchParams.set('audience', config.audience);
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
