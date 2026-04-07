import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';

const ADMIN_PORT = 7400;
const ADMIN_HOST = '127.0.0.1';

interface SidecarStatus {
  running: boolean;
  pid: number | null;
  uptime: number | null;
}

export class SidecarManager {
  private process: ChildProcess | null = null;
  private binaryPath: string;
  private configPath: string;
  private startedAt: number | null = null;
  private logs: string[] = [];

  constructor(binaryPath?: string) {
    this.binaryPath = binaryPath ?? this.resolveBinaryPath();
    this.configPath = path.join(os.homedir(), '.qurl', 'frpc.toml');
  }

  private resolveBinaryPath(): string {
    const binaryName = process.platform === 'win32' ? 'qurl-frpc.exe' : 'qurl-frpc';

    // 1. Bundled in app resources (production)
    if (process.resourcesPath) {
      const bundled = path.join(process.resourcesPath, 'bin', binaryName);
      if (fs.existsSync(bundled)) return bundled;
    }

    // 2. Adjacent to the app (development)
    const adjacent = path.join(process.cwd(), 'bin', binaryName);
    if (fs.existsSync(adjacent)) return adjacent;

    // 3. In ~/.qurl/bin/
    const home = path.join(os.homedir(), '.qurl', 'bin', binaryName);
    if (fs.existsSync(home)) return home;

    // 4. Fall back to PATH lookup
    return binaryName;
  }

  async start(): Promise<void> {
    if (this.process && !this.process.killed) {
      throw new Error('Sidecar is already running');
    }

    const args = ['run', '--config', this.configPath];

    // Ensure config directory exists
    const configDir = path.dirname(this.configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Write a default config if none exists
    if (!fs.existsSync(this.configPath)) {
      this.writeDefaultConfig();
    }

    return new Promise((resolve, reject) => {
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
          reject(new Error(`Failed to start sidecar: ${err.message}`));
        });

        this.process.on('exit', (code) => {
          this.process = null;
          this.startedAt = null;
          if (code !== 0 && code !== null) {
            this.logs.push(`[exit] Process exited with code ${code}`);
          }
        });

        // Give it a moment to start or fail
        setTimeout(() => {
          if (this.process && !this.process.killed) {
            resolve();
          }
        }, 500);
      } catch (err) {
        reject(err);
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
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
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

  async pushConfig(config: string): Promise<void> {
    await this.adminRequest('PUT', '/api/config', config);
  }

  async reload(): Promise<void> {
    await this.adminRequest('PUT', '/api/reload');
  }

  private adminRequest(method: string, endpoint: string, body?: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: ADMIN_HOST,
          port: ADMIN_PORT,
          path: endpoint,
          method,
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          timeout: 5000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on('end', () => {
            try {
              resolve(data ? JSON.parse(data) : null);
            } catch {
              resolve(data);
            }
          });
        },
      );

      req.on('error', (err) => {
        reject(new Error(`Admin API request failed: ${err.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Admin API request timed out'));
      });

      if (body) req.write(body);
      req.end();
    });
  }

  private writeDefaultConfig(): void {
    const config = `# qurl-frpc default configuration
# See https://docs.layerv.ai/qurl/reverse-proxy for details

serverAddr = "0.0.0.0"
serverPort = 7000

webServer.addr = "127.0.0.1"
webServer.port = ${ADMIN_PORT}

# Proxies are configured dynamically via the admin API
`;
    fs.writeFileSync(this.configPath, config, 'utf-8');
  }
}
