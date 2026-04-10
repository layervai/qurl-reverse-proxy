/**
 * QURL API client wrapper for the Electron main process.
 *
 * Bridges the ESM-only @layerv/qurl SDK into the CJS main process.
 * Patches the SDK's exports map to add a "default" condition at runtime
 * since it only defines "import" (no "default" or "require").
 */

import type { QURLClient as QURLClientType } from '@layerv/qurl';
import { getTokens } from './auth';
import path from 'path';
import fs from 'fs';

const API_BASE_URLS: Record<string, string> = {
  production: 'https://api.layerv.ai',
  staging: process.env.QURL_API_URL || 'https://api.layerv.xyz',
};

let cachedClient: QURLClientType | null = null;
let cachedToken: string | null = null;

/**
 * True ESM dynamic import that survives tsc commonjs transpilation.
 * tsc converts `import('x')` to `require('x')` when module=commonjs.
 * This uses Function constructor to keep it as a real import() at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

/**
 * Dynamically import the ESM-only @layerv/qurl SDK from CJS.
 *
 * The SDK's package.json exports map only defines "import" (no "default"/"require"),
 * and Electron's CJS main process can't resolve it. We fix this by:
 * 1. Patching the SDK's exports to add a "default" condition (idempotent)
 * 2. Using a real ESM import() that isn't converted to require() by tsc
 */
async function importSDK(): Promise<typeof import('@layerv/qurl')> {
  const pkgPath = path.join(__dirname, '..', '..', 'node_modules', '@layerv', 'qurl', 'package.json');

  // Patch exports to add "default" condition if missing (idempotent)
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    if (pkg.exports?.['.'] && !pkg.exports['.'].default) {
      pkg.exports['.'].default = pkg.exports['.'].import;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    }
  } catch {
    // If patching fails, try the import anyway
  }

  return dynamicImport('@layerv/qurl');
}

/**
 * Get or create a QURLClient instance using current auth tokens.
 * Returns null when the user is not signed in.
 */
export async function getClient(): Promise<QURLClientType | null> {
  const tokens = getTokens();
  if (!tokens || !tokens.accessToken) {
    cachedClient = null;
    cachedToken = null;
    return null;
  }

  // Recreate client if token changed
  if (cachedClient && cachedToken === tokens.accessToken) {
    return cachedClient;
  }

  let QURLClient;
  try {
    ({ QURLClient } = await importSDK());
  } catch (err) {
    throw new Error(
      `Failed to load QURL SDK: ${(err as Error).message}. ` +
      'Ensure @layerv/qurl is installed and built.'
    );
  }

  const baseUrl = API_BASE_URLS[tokens.environment] || API_BASE_URLS.production;

  cachedClient = new QURLClient({
    apiKey: tokens.accessToken,
    baseUrl,
  });
  cachedToken = tokens.accessToken;

  return cachedClient;
}

/**
 * Clear the cached client (e.g., on sign-out).
 */
export function clearClient(): void {
  cachedClient = null;
  cachedToken = null;
}

/**
 * Make a direct authenticated API request.
 * Used for endpoints not covered by the SDK (resource detail with QURLs, sessions).
 */
export async function apiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const tokens = getTokens();
  if (!tokens?.accessToken) throw new Error('Not authenticated');
  const baseUrl = API_BASE_URLS[tokens.environment] || API_BASE_URLS.production;

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${tokens.accessToken}`,
  };
  if (body) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const errorBody = await response.json() as { error?: { detail?: string; title?: string } };
      detail = errorBody.error?.detail || errorBody.error?.title || detail;
    } catch { /* use statusText */ }
    throw new Error(detail);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
