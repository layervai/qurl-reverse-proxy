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

  constructor(port: number = 9876) {
    this.port = port;
  }

  async serve(filePath: string): Promise<ServeResult> {
    await this.stop();

    const stat = fs.statSync(filePath);
    const isDirectory = stat.isDirectory();

    this.servingPath = filePath;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        try {
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
      // Serve directory listing
      const entries = fs.readdirSync(fullPath, { withFileTypes: true });
      const items = entries.map((entry) => {
        const isDir = entry.isDirectory();
        const href = path.posix.join(urlPath, entry.name) + (isDir ? '/' : '');
        const size = isDir ? '-' : this.formatSize(fs.statSync(path.join(fullPath, entry.name)).size);
        return `<tr>
          <td><a href="${href}">${entry.name}${isDir ? '/' : ''}</a></td>
          <td>${size}</td>
        </tr>`;
      });

      const html = `<!DOCTYPE html>
<html>
<head><title>Index of ${urlPath}</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0a0e27; color: #e0e0e0; padding: 2rem; }
  a { color: #4facfe; text-decoration: none; }
  a:hover { text-decoration: underline; }
  table { border-collapse: collapse; width: 100%; max-width: 800px; }
  th, td { text-align: left; padding: 0.5rem 1rem; border-bottom: 1px solid #1a1e37; }
  th { color: #888; font-weight: 500; }
</style>
</head>
<body>
  <h2>Index of ${urlPath}</h2>
  <table>
    <tr><th>Name</th><th>Size</th></tr>
    ${urlPath !== '/' ? '<tr><td><a href="../">../</a></td><td>-</td></tr>' : ''}
    ${items.join('\n')}
  </table>
</body>
</html>`;

      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
      res.end(html);
    } else {
      this.serveFile(fullPath, req, res);
    }
  }

  private formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }
}
