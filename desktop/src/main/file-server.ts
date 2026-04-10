import http from 'http';
import fs from 'fs';
import path from 'path';
import { AddressInfo } from 'net';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

interface ServeResult {
  port: number;
  url: string;
}

export class FileServer {
  private server: http.Server | null = null;
  private port: number;
  private servingPath: string | null = null;
  private expiresAt: number | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(port: number = 9876) {
    this.port = port;
  }

  /**
   * Set an expiration time. After this time, requests return 410 Gone
   * and the server auto-stops.
   */
  setExpiry(expiresAtMs: number): void {
    this.expiresAt = expiresAtMs;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    const delay = expiresAtMs - Date.now();
    if (delay > 0) {
      this.expiryTimer = setTimeout(() => this.stop(), delay);
    }
  }

  private isExpired(): boolean {
    return this.expiresAt !== null && Date.now() >= this.expiresAt;
  }

  async serve(filePath: string): Promise<ServeResult> {
    await this.stop();

    const stat = fs.statSync(filePath);
    const isDirectory = stat.isDirectory();

    this.servingPath = filePath;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        try {
          if (this.isExpired()) {
            res.writeHead(410, { 'Content-Type': 'text/plain' });
            res.end('Gone — this share has expired');
            return;
          }
          if (isDirectory) {
            this.serveDirectory(filePath, req, res);
          } else {
            this.serveFile(filePath, req, res);
          }
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Server Error');
        }
      });

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          // Try a random port if default is taken
          this.server!.listen(0, '127.0.0.1');
        } else {
          reject(err);
        }
      });

      this.server.on('listening', () => {
        const addr = this.server!.address() as AddressInfo;
        this.port = addr.port;
        resolve({
          port: this.port,
          url: `http://127.0.0.1:${this.port}`,
        });
      });

      this.server.listen(this.port, '127.0.0.1');
    });
  }

  async stop(): Promise<void> {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
    if (!this.server) return;

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null;
        this.servingPath = null;
        resolve();
      });
      // Force-close connections after a timeout
      setTimeout(() => {
        this.server = null;
        this.servingPath = null;
        resolve();
      }, 2000);
    });
  }

  isServing(): boolean {
    return this.server !== null && this.server.listening;
  }

  getServingPath(): string | null {
    return this.servingPath;
  }

  getPort(): number {
    return this.port;
  }

  private serveFile(filePath: string, _req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    const stat = fs.statSync(filePath);

    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Content-Disposition': `inline; filename="${path.basename(filePath)}"`,
      'Cache-Control': 'no-cache',
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('error', () => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error reading file');
    });
  }

  private serveDirectory(
    basePath: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    const urlPath = decodeURIComponent(req.url || '/');
    const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    const fullPath = path.join(basePath, safePath);

    // Prevent directory traversal
    if (!fullPath.startsWith(basePath)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(fullPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      // At the root level, flatten token directories to show actual filenames
      const isRoot = safePath === '/' || safePath === '.' || safePath === '';
      let items: string[] = [];

      if (isRoot) {
        // Walk each token directory and list the files inside
        const tokenDirs = fs.readdirSync(fullPath, { withFileTypes: true }).filter((e) => e.isDirectory());
        for (const tokenDir of tokenDirs) {
          const tokenPath = path.join(fullPath, tokenDir.name);
          try {
            const files = fs.readdirSync(tokenPath, { withFileTypes: true });
            for (const file of files) {
              if (file.isFile()) {
                const fileStat = fs.statSync(path.join(tokenPath, file.name));
                const href = `/${tokenDir.name}/${encodeURIComponent(file.name)}`;
                const size = this.formatSize(fileStat.size);
                const modified = fileStat.mtime.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                items.push(`<tr>
                  <td><a href="${href}">${this.escapeHtml(file.name)}</a></td>
                  <td>${size}</td>
                  <td>${modified}</td>
                </tr>`);
              }
            }
          } catch { /* skip unreadable dirs */ }
        }
      } else {
        const entries = fs.readdirSync(fullPath, { withFileTypes: true });
        items = entries.map((entry) => {
          const isDir = entry.isDirectory();
          const href = path.posix.join(urlPath, entry.name) + (isDir ? '/' : '');
          const fileStat = fs.statSync(path.join(fullPath, entry.name));
          const size = isDir ? '-' : this.formatSize(fileStat.size);
          const modified = fileStat.mtime.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
          return `<tr>
            <td><a href="${href}">${this.escapeHtml(entry.name)}${isDir ? '/' : ''}</a></td>
            <td>${size}</td>
            <td>${modified}</td>
          </tr>`;
        });
      }

      const title = isRoot ? 'Shared Files' : `Index of ${this.escapeHtml(urlPath)}`;
      const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>${title} - QURL</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; background: #030712; color: #d1d5db; padding: 2.5rem; min-height: 100vh; }
  .header { margin-bottom: 2rem; }
  .header h1 { font-size: 1.25rem; font-weight: 600; color: #f9fafb; letter-spacing: -0.01em; }
  .header p { font-size: 0.8125rem; color: #6b7280; margin-top: 0.25rem; }
  .bar { height: 3px; width: 60px; background: linear-gradient(90deg, #0099FF, #D406B9); border-radius: 2px; margin-top: 0.75rem; }
  table { border-collapse: collapse; width: 100%; max-width: 720px; }
  th { text-align: left; padding: 0.625rem 1rem; color: #6b7280; font-weight: 500; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid rgba(255,255,255,0.06); }
  td { padding: 0.75rem 1rem; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 0.8125rem; }
  td:nth-child(2), td:nth-child(3) { color: #6b7280; font-size: 0.75rem; }
  tr:hover td { background: rgba(255,255,255,0.02); }
  a { color: #0099FF; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .empty { text-align: center; padding: 3rem 1rem; color: #6b7280; }
  .brand { position: fixed; bottom: 1.5rem; right: 2rem; font-size: 0.6875rem; color: #374151; letter-spacing: 0.05em; }
</style>
</head>
<body>
  <div class="header">
    <h1>${title}</h1>
    <p>${isRoot ? 'Files currently being shared through QURL' : ''}</p>
    <div class="bar"></div>
  </div>
  ${items.length === 0
    ? '<div class="empty">No files currently shared</div>'
    : `<table>
    <tr><th>File</th><th>Size</th><th>Modified</th></tr>
    ${!isRoot && urlPath !== '/' ? '<tr><td><a href="../">..</a></td><td></td><td></td></tr>' : ''}
    ${items.join('\n')}
  </table>`}
  <div class="brand">QURL File Sharing</div>
</body>
</html>`;

      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
      res.end(html);
    } else {
      this.serveFile(fullPath, req, res);
    }
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }
}
