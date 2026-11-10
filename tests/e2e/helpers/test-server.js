/**
 * Test Server Harness
 * Spawns and manages an isolated server.js instance for E2E testing.
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { TestFailure } = require('./assertions');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const SERVER_PATH = path.join(ROOT_DIR, 'server.js');

class TestServer {
  constructor(options = {}) {
    this.port = options.port || 3199;
    this.host = '127.0.0.1';
    this.downloadDir = options.downloadDir || path.join(os.tmpdir(), `video-dl-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    this.proc = null;
    this.baseUrl = `http://${this.host}:${this.port}`;
    this.logs = [];
    this.env = options.env || {};
  }

  async start() {
    fs.mkdirSync(this.downloadDir, { recursive: true });

    const serverEnv = {
      ...process.env,
      PORT: String(this.port),
      HOST: this.host,
      DOWNLOADS_DIR: this.downloadDir,
      IZ_LOCAL: '1', // Local desktop mode: bypass password for E2E automation
      FFMPEG_PATH: process.env.FFMPEG_PATH || '/opt/homebrew/bin/ffmpeg',
      FFPROBE_PATH: process.env.FFPROBE_PATH || '/opt/homebrew/bin/ffprobe',
      ...this.env,
    };

    this.proc = spawn(process.execPath, [SERVER_PATH], {
      env: serverEnv,
      cwd: ROOT_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.proc.stdout.on('data', (d) => {
      this.logs.push(`[stdout] ${d.toString()}`);
    });
    this.proc.stderr.on('data', (d) => {
      this.logs.push(`[stderr] ${d.toString()}`);
    });

    // Wait for server to respond
    const start = Date.now();
    const timeout = 10000;
    while (Date.now() - start < timeout) {
      try {
        const res = await this.get('/api/default-path');
        if (res.status === 200) {
          return this.baseUrl;
        }
      } catch {
        // Retry
      }
      await new Promise(r => setTimeout(r, 200));
    }

    this.stop();
    throw new TestFailure(`Test server failed to start within ${timeout}ms. Logs:\n${this.logs.slice(-30).join('')}`);
  }

  async stop() {
    if (this.proc) {
      try {
        this.proc.kill('SIGKILL');
      } catch {}
      this.proc = null;
    }
    // Clean up temp download directory
    try {
      if (fs.existsSync(this.downloadDir)) {
        fs.rmSync(this.downloadDir, { recursive: true, force: true });
      }
    } catch {}
  }

  request(method, endpoint, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint, this.baseUrl);
      const reqHeaders = {
        'Accept': 'application/json',
        ...headers,
      };

      let payload = null;
      if (body) {
        payload = typeof body === 'string' ? body : JSON.stringify(body);
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = Buffer.byteLength(payload);
      }

      const req = http.request(url, {
        method,
        headers: reqHeaders,
        timeout: 30000,
      }, (res) => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          let data = raw;
          try {
            data = JSON.parse(raw);
          } catch {}
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data,
            raw,
          });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timeout for ${method} ${endpoint}`));
      });

      if (payload) req.write(payload);
      req.end();
    });
  }

  get(endpoint, headers = {}) {
    return this.request('GET', endpoint, null, headers);
  }

  post(endpoint, body = {}, headers = {}) {
    return this.request('POST', endpoint, body, headers);
  }

  patch(endpoint, body = {}, headers = {}) {
    return this.request('PATCH', endpoint, body, headers);
  }

  delete(endpoint, body = null, headers = {}) {
    return this.request('DELETE', endpoint, body, headers);
  }

  async waitForJob(jobId, timeoutMs = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await this.get('/api/queue');
      if (res.status === 200 && Array.isArray(res.body)) {
        const job = res.body.find(j => j.id === jobId);
        if (job) {
          if (['done', 'error', 'cancelled'].includes(job.status)) {
            return job;
          }
        } else {
          // Check history if removed from queue
          const histRes = await this.get('/api/history');
          if (histRes.status === 200 && Array.isArray(histRes.body)) {
            const histJob = histRes.body.find(h => h.id === jobId);
            if (histJob) return { ...histJob, status: 'done' };
          }
        }
      }
      await new Promise(r => setTimeout(r, 250));
    }
    throw new TestFailure(`Job ${jobId} did not settle within ${timeoutMs}ms`);
  }
}

module.exports = {
  TestServer,
};
