import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';

const ADMIN_PORT = 7400;
const ADMIN_HOST = '127.0.0.1';
const CONFIG_DIR = path.join(os.homedir(), '.config', 'qurl');
const CONFIG_PATH = path.join(CONFIG_DIR, 'qurl-proxy.yaml');

interface SidecarStatus {
  running: boolean;
  pid: number | null;
  uptime: number | null;
}

export class SidecarManager {
  private process: ChildProcess | null = null;
  private binaryPath: string;
  private startedAt: number | null = null;
  private logs: string[] = [];

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

  async start(): Promise<void> {
    if (this.process && !this.process.killed) {
      throw new Error('Sidecar is already running');
    }

    // Verify binary exists
    if (!fs.existsSync(this.binaryPath)) {
      throw new Error(
        `qurl-frpc not found at: ${this.binaryPath}\n` +
        'Build it with "make frpc" from the project root.'
      );
    }

    // Ensure config directory and file exist
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    if (!fs.existsSync(CONFIG_PATH)) {
      this.writeDefaultConfig();
    }

    // Check that config has routes
    const configContent = fs.readFileSync(CONFIG_PATH, 'utf-8');
    if (!configContent.includes('routes:') || !configContent.includes('- name:')) {
      throw new Error(
        'No services configured. Add a service first:\n' +
        '  qurl-frpc add --target http://localhost:8080 --name "My App"'
      );
    }

    const args = ['run', '--config', CONFIG_PATH];

    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (!settled) { settled = true; fn(); }
      };

      try {
        this.process = spawn(this.binaryPath, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
        });

        this.startedAt = Date.now();
        this.logs = [];

        this.process.stdout?.on('data', (data: Buffer) => {
          const line = data.toString().trim();
          if (line) {
            this.logs.push(line);
            if (this.logs.length > 500) this.logs.shift();
          }
        });

        this.process.stderr?.on('data', (data: Buffer) => {
          const line = data.toString().trim();
          if (line) {
            this.logs.push(`[stderr] ${line}`);
            if (this.logs.length > 500) this.logs.shift();
          }
        });

        this.process.on('error', (err) => {
          this.process = null;
          this.startedAt = null;
          settle(() => reject(new Error(`Failed to start: ${err.message}`)));
        });

        this.process.on('exit', (code) => {
          this.process = null;
          this.startedAt = null;
          if (code !== 0 && code !== null) {
            const lastLogs = this.logs.slice(-5).join('\n');
            settle(() => reject(new Error(
              `qurl-frpc exited with code ${code}${lastLogs ? '\n' + lastLogs : ''}`
            )));
          }
        });

        // If still running after 1.5s, consider it started
        setTimeout(() => {
          settle(() => {
            if (this.process && !this.process.killed) {
              resolve();
            } else {
              reject(new Error('qurl-frpc exited immediately'));
            }
          });
        }, 1500);
      } catch (err) {
        settle(() => reject(err));
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.process || this.process.killed) {
      this.process = null;
      this.startedAt = null;
      return;
    }

    return new Promise((resolve) => {
      const proc = this.process!;
      const forceKillTimer = setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL');
        this.process = null;
        this.startedAt = null;
        resolve();
      }, 5000);

      proc.on('exit', () => {
        clearTimeout(forceKillTimer);
        this.process = null;
        this.startedAt = null;
        resolve();
      });

      proc.kill('SIGTERM');
    });
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  getStatus(): SidecarStatus {
    const running = this.isRunning();
    return {
      running,
      pid: running ? this.process!.pid ?? null : null,
      uptime: running && this.startedAt ? Date.now() - this.startedAt : null,
    };
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  // Admin API calls (localhost:7400)

  async getAdminStatus(): Promise<unknown> {
    return this.adminRequest('GET', '/api/status');
  }

  async reload(): Promise<void> {
    await this.adminRequest('GET', '/api/reload');
  }

  private adminRequest(method: string, endpoint: string, body?: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: ADMIN_HOST,
          port: ADMIN_PORT,
          path: endpoint,
          method,
          auth: 'admin:admin',
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

  private writeDefaultConfig(): void {
    const yaml = `# QURL Reverse Proxy configuration
# Docs: https://docs.layerv.ai/qurl/reverse-proxy

server:
  addr: acdemo.opennhp.org
  port: 7000
  token: opennhp-frp

nhp:
  enabled: false

qurl:
  api_url: https://api.layerv.ai/v1

routes: []
# Add services with: qurl-frpc add --target http://localhost:8080 --name "My App"
`;
    fs.writeFileSync(CONFIG_PATH, yaml, 'utf-8');
  }
}
