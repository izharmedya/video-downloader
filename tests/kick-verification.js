// tests/kick-verification.js
// Verification suite for Kick video resolution and normalization

const http = require('http');

const PORT = 3131;
const BASE_URL = `http://localhost:${PORT}`;

function post(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function run() {
  console.log('Testing Kick URL resolution and /api/info...');

  const kickUrl = 'https://kick.com/blackrose/videos/01a1a6a4-f558-74d1-af38-029a2ab2896a';
  const res = await post('/api/info', { url: kickUrl });

  if (res.status !== 200) {
    console.error('FAILED: Status code is', res.status, res.data || res.raw);
    process.exit(1);
  }

  const { data } = res;
  console.log('Title:', data.title);
  console.log('Platform:', data.platform);
  console.log('Duration:', data.duration);
  console.log('Uploader:', data.uploader);
  console.log('Stream URL:', data.stream_url?.slice(0, 60) + '...');
  console.log('Best format label:', data.formats?.[0]?.label);

  if (data.platform !== 'Kick') throw new Error('Expected platform Kick');
  if (!data.stream_url || !data.stream_url.includes('.m3u8')) throw new Error('Expected stream_url with .m3u8');
  if (!data.title || data.title === 'master') throw new Error('Expected valid title, got: ' + data.title);
  if (!data.duration || data.duration < 1000) throw new Error('Expected valid duration');
  if (!data.thumbnail) throw new Error('Expected thumbnail');

  console.log('\nAll Kick verification tests PASSED! ✅');
}

run().catch(err => {
  console.error('Kick verification failed:', err);
  process.exit(1);
});
