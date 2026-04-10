import { app } from 'electron';
import https from 'https';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { SidecarManager } from './sidecar';

const execFileAsync = promisify(execFile);

const GITHUB_REPO = 'layervai/qurl-reverse-proxy';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

const CONFIG_DIR = path.join(os.homedir(), '.config', 'qurl');
const CACHE_PATH = path.join(CONFIG_DIR, 'update-check.json');
const STAGING_DIR = path.join(CONFIG_DIR, '.update-staging');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const INITIAL_DELAY_MS = 30 * 1000; // 30 seconds after launch

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
}

interface CachedCheck {
  tunnelUpdate: TunnelUpdateInfo | null;
  appUpdate: AppUpdateInfo | null;
  checkedAt: number;
  etag?: string;
}

export interface TunnelUpdateInfo {
  current: string;
  latest: string;
  downloaded: boolean;
  releaseUrl: string;
  assetUrl: string;
}

export interface AppUpdateInfo {
  current: string;
  latest: string;
  releaseUrl: string;
  status: 'available' | 'downloading' | 'downloaded' | 'error';
  downloadProgress?: number;
  error?: string;
}

export interface UpdateCheckResult {
  tunnelUpdate: TunnelUpdateInfo | null;
  appUpdate: AppUpdateInfo | null;
}

/**
 * Manages background update checking, downloading, and applying for both
 * the tunnel sidecar binary and the desktop app.
 *
 * Sidecar updates: custom GitHub Releases logic (download tarball, stage, swap).
 * App updates (packaged): electron-updater (auto-download + quit-and-install).
 * App updates (dev): manual GitHub API check, shows link to releases page.
 */
export class UpdateManager {
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private updating = false;
  private cachedResult: UpdateCheckResult | null = null;
  private onUpdateCallback: ((result: UpdateCheckResult) => void) | null = null;
  private appUpdaterReady = false;

  /**
   * Start periodic update checks. Runs an initial check after a short
   * delay, then every CHECK_INTERVAL_MS.
   */
  startPeriodicCheck(onUpdate: (result: UpdateCheckResult) => void): void {
    this.onUpdateCallback = onUpdate;

    // Load cached result for immediate use.
    this.cachedResult = this.loadCache();

    // If we have a cached result with a downloaded tunnel update, notify immediately.
    if (this.cachedResult?.tunnelUpdate?.downloaded) {
      onUpdate(this.cachedResult);
    }

    // Initialize electron-updater for app updates in packaged builds.
    if (app.isPackaged) {
      this.initAppUpdater();
    }

    this.initialTimer = setTimeout(async () => {
      await this.runCheck();
    }, INITIAL_DELAY_MS);

    this.checkTimer = setInterval(async () => {
      await this.runCheck();
    }, CHECK_INTERVAL_MS);
  }

  /**
   * Stop periodic checks and clean up timers.
   */
  stop(): void {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  /**
   * Manually trigger an update check. Returns the result.
   */
  async checkForUpdates(): Promise<UpdateCheckResult> {
    const result = await this.runCheck();
    return result ?? { tunnelUpdate: null, appUpdate: null };
  }

  /**
   * Apply a staged tunnel update: stop sidecar -> swap binary -> restart.
   */
  async applyAndRelaunch(sidecar: SidecarManager): Promise<{ restarted: boolean }> {
    if (this.updating) {
      throw new Error('Update already in progress');
    }
    this.updating = true;

    try {
      const binaryDir = path.dirname(sidecar.getBinaryPath());
      const binaryName = path.basename(sidecar.getBinaryPath());

      // Verify staged update exists.
      const stagedBinary = path.join(STAGING_DIR, binaryName);
      if (!fs.existsSync(stagedBinary)) {
        throw new Error('No staged update found. Run a check first.');
      }

      const wasRunning = sidecar.isRunning();

      // Stop the sidecar if running.
      if (wasRunning) {
        await sidecar.stop();
      }

      // Apply: move staged files into the binary directory.
      applyStaged(STAGING_DIR, binaryDir, binaryName);

      // Clear cache and staging.
      this.clearCache();
      this.cachedResult = null;

      // Restart if it was running.
      if (wasRunning) {
        await sidecar.start();
      }

      return { restarted: wasRunning };
    } finally {
      this.updating = false;
    }
  }

  /**
   * Install a downloaded app update. Quits the app and installs the new version.
   */
  installAppUpdate(): void {
    if (!app.isPackaged) {
      throw new Error('App auto-update is only available in packaged builds');
    }
    // electron-updater handles quit + install + relaunch.
    const { autoUpdater } = require('electron-updater');
    autoUpdater.quitAndInstall(false, true);
  }

  /**
   * Return the last known update status (from cache or recent check).
   */
  getStatus(): UpdateCheckResult {
    return this.cachedResult ?? { tunnelUpdate: null, appUpdate: null };
  }

  // ── Private methods ──

  /**
   * Initialize electron-updater for seamless app auto-updates.
   * Only called when app.isPackaged is true.
   */
  private initAppUpdater(): void {
    try {
      const { autoUpdater } = require('electron-updater');

      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.autoRunAppAfterInstall = true;

      autoUpdater.on('update-available', (info: { version: string }) => {
        this.updateAppStatus({
          current: app.getVersion(),
          latest: `v${info.version}`,
          releaseUrl: `https://github.com/${GITHUB_REPO}/releases/tag/v${info.version}`,
          status: 'downloading',
          downloadProgress: 0,
        });
      });

      autoUpdater.on('download-progress', (progress: { percent: number }) => {
        if (this.cachedResult?.appUpdate) {
          this.cachedResult.appUpdate.downloadProgress = Math.round(progress.percent);
          this.cachedResult.appUpdate.status = 'downloading';
          this.notifyRenderer();
        }
      });

      autoUpdater.on('update-downloaded', (info: { version: string }) => {
        this.updateAppStatus({
          current: app.getVersion(),
          latest: `v${info.version}`,
          releaseUrl: `https://github.com/${GITHUB_REPO}/releases/tag/v${info.version}`,
          status: 'downloaded',
          downloadProgress: 100,
        });
      });

      autoUpdater.on('error', (err: Error) => {
        console.error('[updater] app auto-update error:', err.message);
        if (this.cachedResult?.appUpdate) {
          this.cachedResult.appUpdate.status = 'error';
          this.cachedResult.appUpdate.error = err.message;
          this.notifyRenderer();
        }
      });

      this.appUpdaterReady = true;
    } catch (err) {
      console.error('[updater] failed to init electron-updater:', (err as Error).message);
    }
  }

  private updateAppStatus(appUpdate: AppUpdateInfo): void {
    this.cachedResult = {
      ...this.getStatus(),
      appUpdate,
    };
    this.notifyRenderer();
  }

  private notifyRenderer(): void {
    if (this.onUpdateCallback && this.cachedResult) {
      this.onUpdateCallback(this.cachedResult);
    }
  }

  /**
   * Run a full update check cycle:
   * - Sidecar: custom GitHub API check + download
   * - App (packaged): trigger electron-updater check
   * - App (dev): manual GitHub API version comparison
   */
  private async runCheck(): Promise<UpdateCheckResult | null> {
    try {
      // Check sidecar updates via our custom GitHub logic.
      const sidecarResult = await this.checkSidecarUpdate();

      // Check app updates.
      if (app.isPackaged && this.appUpdaterReady) {
        // electron-updater handles its own check/download cycle via events.
        try {
          const { autoUpdater } = require('electron-updater');
          await autoUpdater.checkForUpdates();
        } catch (err) {
          console.error('[updater] electron-updater check failed:', (err as Error).message);
        }
      } else {
        // Dev mode: manual version comparison for informational display.
        await this.checkAppUpdateManual();
      }

      if (sidecarResult || this.cachedResult?.appUpdate) {
        this.notifyRenderer();
      }

      return this.cachedResult;
    } catch (err) {
      console.error('[updater] check failed:', (err as Error).message);
      return null;
    }
  }

  /**
   * Check for sidecar binary updates using the GitHub Releases API.
   * Downloads the update in the background if available.
   */
  private async checkSidecarUpdate(): Promise<TunnelUpdateInfo | null> {
    try {
      // Check if cached result is still fresh.
      const cached = this.loadCache();
      if (cached && Date.now() - cached.checkedAt < CHECK_INTERVAL_MS) {
        if (this.cachedResult) {
          this.cachedResult.tunnelUpdate = cached.tunnelUpdate;
        }
        return cached.tunnelUpdate;
      }

      const release = await this.fetchLatestRelease(cached?.etag);
      if (!release) {
        // 304 Not Modified — cache is still valid.
        return this.cachedResult?.tunnelUpdate ?? null;
      }

      const { data, etag } = release;
      const latestVersion = data.tag_name;

      // Get current tunnel version.
      const tunnelVersion = await this.getTunnelVersion();

      let tunnelUpdate: TunnelUpdateInfo | null = null;

      if (tunnelVersion && tunnelVersion !== 'dev' && compareSemver(latestVersion, tunnelVersion) > 0) {
        const assetName = this.getAssetName(latestVersion);
        const asset = data.assets.find(a => a.name === assetName);

        tunnelUpdate = {
          current: tunnelVersion,
          latest: latestVersion,
          downloaded: false,
          releaseUrl: data.html_url,
          assetUrl: asset?.browser_download_url ?? '',
        };

        // Download in background if asset is available.
        if (asset) {
          try {
            await this.downloadUpdate(asset.browser_download_url);
            tunnelUpdate.downloaded = true;
          } catch (err) {
            console.error('[updater] tunnel download failed:', (err as Error).message);
          }
        }
      }

      // Cache the sidecar result.
      this.saveCache({
        tunnelUpdate,
        appUpdate: this.cachedResult?.appUpdate ?? null,
        checkedAt: Date.now(),
        etag,
      });

      if (!this.cachedResult) {
        this.cachedResult = { tunnelUpdate, appUpdate: null };
      } else {
        this.cachedResult.tunnelUpdate = tunnelUpdate;
      }

      return tunnelUpdate;
    } catch (err) {
      console.error('[updater] sidecar check failed:', (err as Error).message);
      return null;
    }
  }

  /**
   * Dev-mode app update check: compare app version against GitHub release tag.
   * Shows a link to the releases page (no auto-download).
   */
  private async checkAppUpdateManual(): Promise<void> {
    try {
      const cached = this.loadCache();
      const release = await this.fetchLatestRelease(cached?.etag);
      if (!release) return;

      const { data } = release;
      const latestVersion = data.tag_name;
      const appVersion = app.getVersion();

      if (appVersion && appVersion !== '0.0.0' && compareSemver(latestVersion, appVersion) > 0) {
        const appUpdate: AppUpdateInfo = {
          current: appVersion,
          latest: latestVersion,
          releaseUrl: data.html_url,
          status: 'available',
        };

        if (!this.cachedResult) {
          this.cachedResult = { tunnelUpdate: null, appUpdate };
        } else {
          this.cachedResult.appUpdate = appUpdate;
        }
      }
    } catch {
      // Best effort in dev mode.
    }
  }

  private async getTunnelVersion(): Promise<string | null> {
    try {
      const tmpSidecar = new SidecarManager();
      const binaryPath = tmpSidecar.getBinaryPath();

      if (!fs.existsSync(binaryPath)) return null;

      const { stdout } = await execFileAsync(binaryPath, ['version', '--short'], {
        timeout: 5000,
      });

      // Parse: "qurl-proxy v1.2.3 (frp 0.67.0, opennhp unknown)"
      const match = stdout.match(/qurl-proxy\s+(v?\d+\.\d+\.\d+)/);
      if (match) return match[1].startsWith('v') ? match[1] : `v${match[1]}`;

      if (stdout.includes('dev')) return 'dev';

      return null;
    } catch {
      return null;
    }
  }

  private getAssetName(tag: string): string {
    const goos = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux';
    const goarch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    return `qurl-reverse-proxy-${tag}-${goos}-${goarch}.tar.gz`;
  }

  private async fetchLatestRelease(etag?: string): Promise<{ data: GitHubRelease; etag?: string } | null> {
    return new Promise((resolve, reject) => {
      const url = new URL(GITHUB_API_URL);
      const options: https.RequestOptions = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'GET',
        headers: {
          'Accept': 'application/vnd.github+json',
          'User-Agent': `qurl-desktop/${app.getVersion()}`,
          ...(etag ? { 'If-None-Match': etag } : {}),
        },
        timeout: 15000,
      };

      const req = https.request(options, (res) => {
        if (res.statusCode === 304) {
          resolve(null);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API returned ${res.statusCode}`));
          return;
        }

        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          try {
            const data = JSON.parse(body) as GitHubRelease;
            resolve({ data, etag: res.headers.etag });
          } catch (err) {
            reject(err);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('GitHub API timeout')); });
      req.end();
    });
  }

  private async downloadUpdate(assetUrl: string): Promise<void> {
    if (fs.existsSync(STAGING_DIR)) {
      fs.rmSync(STAGING_DIR, { recursive: true });
    }
    fs.mkdirSync(STAGING_DIR, { recursive: true });

    const tarballPath = path.join(STAGING_DIR, 'release.tar.gz');

    await this.downloadFile(assetUrl, tarballPath);
    await this.extractTarGz(tarballPath);

    fs.unlinkSync(tarballPath);
  }

  private downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const doRequest = (requestUrl: string, redirectCount: number) => {
        if (redirectCount > 5) {
          reject(new Error('Too many redirects'));
          return;
        }

        const parsedUrl = new URL(requestUrl);
        const requestFn = parsedUrl.protocol === 'https:' ? https.get : http.get;

        requestFn(requestUrl, {
          headers: { 'User-Agent': `qurl-desktop/${app.getVersion()}` },
          timeout: 120000,
        }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            doRequest(res.headers.location, redirectCount + 1);
            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error(`Download returned ${res.statusCode}`));
            return;
          }

          const file = fs.createWriteStream(destPath);
          res.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
          file.on('error', (err) => { fs.unlinkSync(destPath); reject(err); });
        }).on('error', reject);
      };

      doRequest(url, 0);
    });
  }

  private extractTarGz(tarballPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const binaryName = process.platform === 'win32' ? 'qurl-frpc.exe' : 'qurl-frpc';

      const { execFile: execFileCb } = require('child_process');
      execFileCb('tar', ['xzf', tarballPath, '-C', STAGING_DIR, binaryName, '--include=sdk/*'], {
        timeout: 30000,
      }, (err: Error | null) => {
        if (err) {
          execFileCb('tar', ['xzf', tarballPath, '-C', STAGING_DIR, binaryName], {
            timeout: 30000,
          }, (err2: Error | null) => {
            if (err2) reject(err2);
            else resolve();
          });
          return;
        }
        resolve();
      });
    });
  }

  private loadCache(): CachedCheck | null {
    try {
      if (!fs.existsSync(CACHE_PATH)) return null;
      const data = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')) as CachedCheck;
      return data;
    } catch {
      return null;
    }
  }

  private saveCache(data: CachedCheck): void {
    try {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }
      fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Best effort.
    }
  }

  private clearCache(): void {
    try {
      if (fs.existsSync(CACHE_PATH)) fs.unlinkSync(CACHE_PATH);
      if (fs.existsSync(STAGING_DIR)) fs.rmSync(STAGING_DIR, { recursive: true });
    } catch {
      // Best effort.
    }
  }
}

/**
 * Move staged files into the install directory, backing up existing files.
 * On failure, rolls back all changes.
 */
function applyStaged(stagingDir: string, installDir: string, binaryName: string): void {
  const backups: Array<{ original: string; backup: string }> = [];

  const rollback = () => {
    for (const b of backups) {
      try { fs.unlinkSync(b.original); } catch { /* may not exist */ }
      try { fs.renameSync(b.backup, b.original); } catch { /* best effort */ }
    }
  };

  try {
    const entries = fs.readdirSync(stagingDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name === 'sdk') {
        const srcSdk = path.join(stagingDir, 'sdk');
        const dstSdk = path.join(installDir, 'sdk');
        if (!fs.existsSync(dstSdk)) fs.mkdirSync(dstSdk, { recursive: true });

        for (const sdkFile of fs.readdirSync(srcSdk)) {
          const src = path.join(srcSdk, sdkFile);
          const dst = path.join(dstSdk, sdkFile);
          const bak = dst + '.bak';

          if (fs.existsSync(dst)) {
            fs.renameSync(dst, bak);
            backups.push({ original: dst, backup: bak });
          }
          fs.copyFileSync(src, dst);
        }
        continue;
      }

      if (!entry.isFile()) continue;

      const src = path.join(stagingDir, entry.name);
      const dst = path.join(installDir, entry.name);
      const bak = dst + '.bak';

      if (fs.existsSync(dst)) {
        fs.renameSync(dst, bak);
        backups.push({ original: dst, backup: bak });
      }

      fs.copyFileSync(src, dst);

      if (entry.name === binaryName) {
        fs.chmodSync(dst, 0o755);
      }
    }

    // Success — clean up backups and staging.
    for (const b of backups) {
      try { fs.unlinkSync(b.backup); } catch { /* ok */ }
    }
    fs.rmSync(stagingDir, { recursive: true, force: true });

  } catch (err) {
    rollback();
    throw err;
  }
}

/**
 * Compare two semver strings. Returns >0 if a > b, <0 if a < b, 0 if equal.
 */
function compareSemver(a: string, b: string): number {
  const parse = (s: string): [number, number, number] | null => {
    if (!s || s === 'dev') return null;
    const clean = s.replace(/^v/, '').split('-')[0];
    const parts = clean.split('.').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return null;
    return parts as [number, number, number];
  };

  const pa = parse(a);
  const pb = parse(b);

  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;

  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

// Singleton instance.
export const updater = new UpdateManager();
