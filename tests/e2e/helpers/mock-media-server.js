/**
 * Mock Media HTTP Server
 * Serves synthetic media fixtures locally with HTTP Range support for yt-dlp.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  generateH264Mp4,
  generate4KVp9Webm,
  generateOpusWebm,
  generateMp3,
} = require('./media-generator');

class MockMediaServer {
  constructor() {
    this.server = null;
    this.port = 0;
    this.fixtures = {};
  }

  async start() {
    // Pre-generate fixtures
    this.fixtures = {
      '1080p.mp4': generateH264Mp4({ width: 1920, height: 1080, duration: 1 }),
      '4k.webm': generate4KVp9Webm({ width: 3840, height: 2160, duration: 0.5 }),
      'audio.webm': generateOpusWebm({ duration: 1 }),
      'audio.mp3': generateMp3({ duration: 1 }),
    };

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.listen(0, '127.0.0.1', () => {
        this.port = this.server.address().port;
        resolve(this.port);
      });

      this.server.on('error', reject);
    });
  }

  handleRequest(req, res) {
    const url = new URL(req.url, `http://127.0.0.1:${this.port}`);
    const pathname = url.pathname;

    // Custom test routes
    if (pathname === '/media/500') {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('Internal Server Error');
    }

    if (pathname === '/media/empty') {
      res.writeHead(200, { 'Content-Length': 0, 'Content-Type': 'video/mp4' });
      return res.end();
    }

    if (pathname === '/media/corrupt') {
      const junk = Buffer.alloc(1024 * 60, 0xFF);
      res.writeHead(200, { 'Content-Length': junk.length, 'Content-Type': 'video/mp4' });
      return res.end(junk);
    }

    if (pathname === '/media/redirect') {
      res.writeHead(302, { Location: `/media/1080p.mp4` });
      return res.end();
    }

    if (pathname === '/media/slow') {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      const timer = setInterval(() => {
        if (res.writableEnded) {
          clearInterval(timer);
          return;
        }
        res.write(Buffer.alloc(64, 'A'));
      }, 200);
      req.on('close', () => clearInterval(timer));
      return;
    }

    const filename = path.basename(pathname);
    const targetFile = this.fixtures[filename];

    if (!targetFile || !fs.existsSync(targetFile)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('File Not Found');
    }

    const stat = fs.statSync(targetFile);
    const range = req.headers.range;

    const contentType = filename.endsWith('.mp4') ? 'video/mp4'
      : filename.endsWith('.webm') ? 'video/webm'
      : filename.endsWith('.mp3') ? 'audio/mpeg'
      : 'application/octet-stream';

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = (end - start) + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });

      fs.createReadStream(targetFile, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(targetFile).pipe(res);
    }
  }

  getUrl(route) {
    const cleanRoute = route.startsWith('/') ? route : `/${route}`;
    return `http://127.0.0.1:${this.port}${cleanRoute}`;
  }

  async stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}

module.exports = {
  MockMediaServer,
};
