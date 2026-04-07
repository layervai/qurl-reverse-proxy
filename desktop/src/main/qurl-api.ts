/**
 * QURL API client wrapper for the Electron main process.
 *
 * Bridges the ESM-only @layerv/qurl SDK into the CJS main process
 * using dynamic import() and type-only imports.
 */

import type { QURLClient as QURLClientType } from '@layerv/qurl';
import { getTokens } from './auth';

const API_BASE_URLS: Record<string, string> = {
  production: 'https://api.layerv.ai',
  staging: 'https://api.layerv.xyz',
};

let cachedClient: QURLClientType | null = null;
let cachedToken: string | null = null;

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

  const { QURLClient } = await import('@layerv/qurl');
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
