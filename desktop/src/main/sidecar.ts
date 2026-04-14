import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';

const ADMIN_PORT = 7400;
const ADMIN_HOST = '127.0.0.1';
const CONFIG_DIR = path.join(os.homedir(), '.config', 'qurl');
const CONFIG_PATH = path.join(CONFIG_DIR, 'qurl-proxy.yaml');

const STATE_CACHE_TTL = 3000; // 3s — shared across tray and renderer polling

export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';

export interface SidecarStatus {
  running: boolean;
  pid: number | null;
  uptime: number | null;
  connectionState: ConnectionState;
}

export class SidecarManager {
  private process: ChildProcess | null = null;
  private binaryPath: string;
  private startedAt: number | null = null;
  private logs: string[] = [];
  private logPath: string | null = null;

  private restartAttempts = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalStop = false;
  private cachedState: ConnectionState = 'disconnected';
  private stateCacheTime = 0;
  private onStateChange?: (state: ConnectionState) => void;
  private adminAuthCache: string | null = null;
  private connectionPollTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionPollAttempts = 0;

  private readonly MAX_RESTART_ATTEMPTS = 10;
  private readonly INITIAL_RESTART_DELAY = 2000;
  private readonly MAX_RESTART_DELAY = 60000;
  private readonly INITIAL_POLL_INTERVAL = 2000;   // 2s initial poll
  private readonly MAX_POLL_INTERVAL = 30000;       // 30s max poll backoff
  private readonly CONNECTED_POLL_INTERVAL = 10000; // 10s when connected

  constructor(binaryPath?: string) {
    this.binaryPath = binaryPath ?? this.resolveBinaryPath();
  }

  private resolveBinaryPath(): string {
    const binaryName = process.platform === 'win32' ? 'qurl-frpc.exe' : 'qurl-frpc';

    // 1. Bundled in app resources (production)
    if (process.resourcesPath) {
      const bundled = path.join(process.resourcesPath, 'bin', binaryName);
      if (fs.existsSync(bundled)) return bundled;
    }

    // 2. Project root bin/ (development — cwd is desktop/)
    const parentAdj = path.join(process.cwd(), '..', 'bin', binaryName);
    if (fs.existsSync(parentAdj)) return parentAdj;

    // 3. Adjacent bin/ (development — cwd is project root)
    const adjacent = path.join(process.cwd(), 'bin', binaryName);
    if (fs.existsSync(adjacent)) return adjacent;

    // 4. In ~/.qurl/bin/
    const home = path.join(os.homedir(), '.qurl', 'bin', binaryName);
    if (fs.existsSync(home)) return home;

    // 5. Fall back to PATH lookup
    return binaryName;
  }

  getBinaryPath(): string {
    return this.binaryPath;
  }

  getConfigPath(): string {
    return CONFIG_PATH;
  }

  setStateChangeCallback(cb: (state: ConnectionState) => void): void {
    this.onStateChange = cb;
  }

  private emitState(state: ConnectionState): void {
    if (state === this.cachedState) return;
    this.cachedState = state;
    this.stateCacheTime = Date.now();
    this.onStateChange?.(state);
  }

  /**
   * Ensure the config directory and default config file exist.
   * Call this before running any qurl-frpc CLI commands that need the config.
   */
  ensureConfigExists(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    if (!fs.existsSync(CONFIG_PATH)) {
      this.writeDefaultConfig();
    }
  }

  async start(): Promise<void> {
    if (this.process && !this.process.killed) {
      throw new Error('Sidecar is already running');
    }

    this.intentionalStop = false;
    this.restartAttempts = 0;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    // Kill any orphaned frpc processes holding the admin port
    try {
      const { execSync } = require('child_process');
      execSync(`lsof -ti :${ADMIN_PORT} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
    } catch { /* best effort */ }

    if (!fs.existsSync(this.binaryPath)) {
      throw new Error(
        `qurl-frpc not found at: ${this.binaryPath}\n` +
        'Build it with "make frpc" from the project root.'
      );
    }

    this.ensureFilesRoute();

    const args = ['run', '--config', CONFIG_PATH];

    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (!settled) { settled = true; fn(); }
      };

      try {
        // Piped stdio can cause the child process to stall if the pipe buffer fills.
        const logPath = path.join(CONFIG_DIR, 'qurl-frpc.log');
        const logFd = fs.openSync(logPath, 'a');

        this.process = spawn(this.binaryPath, args, {
          stdio: ['ignore', logFd, logFd],
          detached: true,
        });

        this.process.unref();
        this.startedAt = Date.now();
        this.logs = [];
        this.logPath = logPath;
        this.adminAuthCache = null; // invalidate on restart

        fs.closeSync(logFd);

        this.process.on('error', (err) => {
          this.process = null;
          this.startedAt = null;
          this.stopConnectionPoll();
          settle(() => reject(new Error(`Failed to start: ${err.message}`)));
        });

        this.process.on('exit', (code) => {
          this.process = null;
          this.startedAt = null;
          this.stopConnectionPoll();
          if (code !== 0 && code !== null) {
            const lastLogs = this.logs.slice(-5).join('\n');
            settle(() => reject(new Error(
              `qurl-frpc exited with code ${code}${lastLogs ? '\n' + lastLogs : ''}`
            )));
          }
          if (!this.intentionalStop) {
            this.scheduleRestart();
          }
        });

        // Wait briefly for process to stabilize, then start connection polling.
        // Do NOT emit 'connected' — let the poller determine actual state from the admin API.
        setTimeout(() => {
          settle(() => {
            if (this.process && !this.process.killed) {
              this.emitState('reconnecting');
              this.startConnectionPoll();
              resolve();
            } else {
              reject(new Error('qurl-frpc exited immediately'));
            }
          });
        }, 2500);
      } catch (err) {
        settle(() => reject(err));
      }
    });
  }

  /**
   * Poll the FRP admin API to determine actual tunnel connection state.
   * Uses exponential backoff when stuck in 'reconnecting', drops to a
   * relaxed interval once 'connected'.
   */
  private startConnectionPoll(): void {
    this.stopConnectionPoll();
    this.connectionPollAttempts = 0;
    this.pollConnectionOnce();
  }

  private stopConnectionPoll(): void {
    if (this.connectionPollTimer) {
      clearTimeout(this.connectionPollTimer);
      this.connectionPollTimer = null;
    }
  }

  private pollConnectionOnce(): void {
    if (this.intentionalStop || !this.isRunning()) return;

    this.getConnectionState().then((state) => {
      if (this.intentionalStop || !this.isRunning()) return;

      let nextInterval: number;
      if (state === 'connected') {
        // Connected — reset backoff, poll at relaxed interval
        this.connectionPollAttempts = 0;
        nextInterval = this.CONNECTED_POLL_INTERVAL;
      } else {
        // Not connected — exponential backoff
        nextInterval = Math.min(
          this.INITIAL_POLL_INTERVAL * Math.pow(2, this.connectionPollAttempts),
          this.MAX_POLL_INTERVAL,
        );
        this.connectionPollAttempts++;
      }

      this.connectionPollTimer = setTimeout(() => this.pollConnectionOnce(), nextInterval);
    }).catch(() => {
      // Admin API error — back off
      if (this.intentionalStop || !this.isRunning()) return;
      const nextInterval = Math.min(
        this.INITIAL_POLL_INTERVAL * Math.pow(2, this.connectionPollAttempts),
        this.MAX_POLL_INTERVAL,
      );
      this.connectionPollAttempts++;
      this.connectionPollTimer = setTimeout(() => this.pollConnectionOnce(), nextInterval);
    });
  }

  private scheduleRestart(): void {
    if (this.restartAttempts >= this.MAX_RESTART_ATTEMPTS) {
      console.error(`[sidecar] auto-restart gave up after ${this.MAX_RESTART_ATTEMPTS} attempts`);
      this.emitState('disconnected');
      return;
    }

    this.emitState('reconnecting');

    const delay = Math.min(
      this.INITIAL_RESTART_DELAY * Math.pow(2, this.restartAttempts),
      this.MAX_RESTART_DELAY,
    );
    this.restartAttempts++;

    console.log(`[sidecar] auto-restart attempt ${this.restartAttempts}/${this.MAX_RESTART_ATTEMPTS} in ${delay}ms`);

    this.restartTimer = setTimeout(async () => {
      this.restartTimer = null;
      try {
        await this.start();
      } catch (err) {
        console.error('[sidecar] auto-restart failed:', (err as Error).message);
        if (!this.intentionalStop) {
          this.scheduleRestart();
        }
      }
    }, delay);
  }

  async stop(): Promise<void> {
    this.intentionalStop = true;
    this.stopConnectionPoll();
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    if (!this.process || this.process.killed) {
      this.process = null;
      this.startedAt = null;
      this.emitState('disconnected');
      return;
    }

    return new Promise((resolve) => {
      const proc = this.process!;
      const pid = proc.pid;

      const forceKillTimer = setTimeout(() => {
        if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ } }
        this.process = null;
        this.startedAt = null;
        this.emitState('disconnected');
        resolve();
      }, 5000);

      proc.on('exit', () => {
        clearTimeout(forceKillTimer);
        this.process = null;
        this.startedAt = null;
        this.emitState('disconnected');
        resolve();
      });

      if (pid) { try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ } }
    });
  }

  isRunning(): boolean {
    if (!this.process || !this.process.pid) return false;
    try {
      process.kill(this.process.pid, 0);
      return true;
    } catch {
      this.process = null;
      this.startedAt = null;
      return false;
    }
  }

  getStatus(): SidecarStatus {
    const running = this.isRunning();
    return {
      running,
      pid: running ? this.process?.pid ?? null : null,
      uptime: running && this.startedAt ? Date.now() - this.startedAt : null,
      connectionState: this.cachedState,
    };
  }

  /**
   * Query the FRP admin API to determine the actual tunnel connection state.
   * Results are cached for STATE_CACHE_TTL ms so multiple callers (tray, renderer)
   * share a single admin API call per cycle.
   */
  async getConnectionState(): Promise<ConnectionState> {
    if (this.restartTimer) return 'reconnecting';
    if (!this.isRunning()) return 'disconnected';

    // Return cached result if fresh enough
    if (Date.now() - this.stateCacheTime < STATE_CACHE_TTL) {
      return this.cachedState;
    }

    let state: ConnectionState;
    try {
      const status = await this.getAdminStatus() as Record<string, Array<{ status: string }>>;
      const allProxies = Object.values(status).flat();
      if (allProxies.length === 0) {
        state = 'reconnecting';
      } else {
        state = allProxies.some(p => p.status === 'running') ? 'connected' : 'reconnecting';
      }
    } catch {
      state = 'reconnecting';
    }

    // Update cached state and push to renderer if changed
    this.emitState(state);
    return state;
  }

  getLogs(): string[] {
    if (this.logPath) {
      try {
        const content = fs.readFileSync(this.logPath, 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        return lines.slice(-100);
      } catch { /* fall through */ }
    }
    return [...this.logs];
  }

  async getAdminStatus(): Promise<unknown> {
    return this.adminRequest('GET', '/api/status');
  }

  async reload(): Promise<void> {
    await this.adminRequest('GET', '/api/reload');
  }

  /**
   * Read the machine_id from the config file for admin API auth.
   * Cached after first read since machine_id doesn't change at runtime.
   */
  private getAdminAuth(): string {
    if (this.adminAuthCache) return this.adminAuthCache;
    try {
      const config = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const match = config.match(/machine_id:\s*(\S+)/);
      if (match) {
        this.adminAuthCache = `admin:${match[1]}`;
        return this.adminAuthCache;
      }
    } catch { /* fallback */ }
    return 'admin:admin';
  }

  private adminRequest(method: string, endpoint: string, body?: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: ADMIN_HOST,
          port: ADMIN_PORT,
          path: endpoint,
          method,
          auth: this.getAdminAuth(),
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          timeout: 5000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => {
            try { resolve(data ? JSON.parse(data) : null); }
            catch { resolve(data); }
          });
        },
      );
      req.on('error', (err) => reject(new Error(`Admin API: ${err.message}`)));
      req.on('timeout', () => { req.destroy(); reject(new Error('Admin API timeout')); });
      if (body) req.write(body);
      req.end();
    });
  }

  ensureFilesRoute(): void {
    this.ensureConfigExists();
    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    if (!content.includes('name: qurl-files')) {
      const args = [
        'add', '--target', 'http://127.0.0.1:9876',
        '--name', 'qurl-files', '--no-verify',
        '--config', CONFIG_PATH,
      ];
      try {
        const { execFileSync } = require('child_process');
        execFileSync(this.binaryPath, args, { stdio: 'ignore' });
      } catch (err) {
        console.error('[sidecar] failed to add qurl-files route:', (err as Error).message);
      }
    }
  }

  private writeDefaultConfig(): void {
    const serverAddr = process.env.QURL_TUNNEL_ADDR || '127.0.0.1';
    const serverToken = process.env.QURL_TUNNEL_TOKEN || 'qurl-dev-token';
    const apiUrl = process.env.QURL_API_URL || 'https://api.layerv.ai/v1';

    const yaml = `# QURL Reverse Proxy configuration
# Docs: https://docs.layerv.ai/qurl/reverse-proxy

server:
  addr: ${serverAddr}
  port: 7000
  token: ${serverToken}

nhp:
  enabled: false

qurl:
  api_url: ${apiUrl}

routes: []
# The qurl-files route is added automatically on first tunnel start.
`;
    fs.writeFileSync(CONFIG_PATH, yaml, 'utf-8');
  }
}
