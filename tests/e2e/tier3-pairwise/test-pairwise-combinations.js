/**
 * Tier 3 - Cross-Feature Pairwise Combinations
 * Exercises pairwise interactions across features:
 * 4K + Trim, 4K + Speed, Audio + Trim + Speed, Stream-Copy + Rename,
 * Cancellation + Cleanup, Concurrent multi-type queues, and API lifecycle.
 */

const fs = require('fs');
const path = require('path');
const { assertTrue, assertFalse, assertEquals, assertGreaterThan } = require('../helpers/assertions');
const { TestServer } = require('../helpers/test-server');
const { MockMediaServer } = require('../helpers/mock-media-server');
const { probe, isFaststart, assert4KResolution, assertStandaloneMp3Compatible } = require('../helpers/media-probe');

module.exports = {
  name: 'Tier 3: Pairwise Combinations of Features',
  tests: [
    {
      name: 'P01: 4K Video + Section Trimming (Features 8 + 6)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3301 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/4k.webm'),
            trim_start: '00:00:00',
            trim_end: '00:00:01',
            title: '4K Trimmed'
          });

          const job = await server.waitForJob(addRes.body.id, 45000);
          assertEquals(job.status, 'done');
          assert4KResolution(job.filename);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'P02: 4K Video + Playback Speed 1.5x (Features 8 + 6)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3302 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/4k.webm'),
            playback_speed: 1.5,
            title: '4K Speed 1.5x'
          });

          const job = await server.waitForJob(addRes.body.id, 45000);
          assertEquals(job.status, 'done');
          assertTrue(fs.existsSync(job.filename));
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'P03: 4K Video + Custom Name Sanitization (Features 8 + 4)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3303 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/4k.webm'),
            custom_name: '4K B-Roll Reel [Final] #1',
            title: '4K Custom Name'
          });

          const job = await server.waitForJob(addRes.body.id, 45000);
          assertEquals(job.status, 'done');
          assertTrue(path.basename(job.filename).includes('4K B-Roll Reel'));
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'P04: Audio Only + Section Trimming (Features 5 + 6)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3304 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: true,
            trim_start: '00:00:00',
            trim_end: '00:00:01',
            title: 'Audio Trimmed'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          const info = probe(job.filename);
          assertEquals(info.streams[0].codec_name, 'mp3');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'P05: Audio Only + Playback Speed 2.0x (Features 5 + 6)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3305 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: true,
            playback_speed: 2,
            title: 'Audio 2x Speed'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          assertTrue(fs.existsSync(job.filename));
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'P06: Audio Only + Trimming + Playback Speed Combined (Features 5 + 6 + 7)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3306 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: true,
            trim_start: '00:00:00',
            trim_end: '00:00:01',
            playback_speed: 1.5,
            title: 'Audio Trim + Speed'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          assertTrue(fs.existsSync(job.filename));
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'P07: Audio Only + Custom Name Sanitization (Features 5 + 4)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3307 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: true,
            custom_name: 'Podcast_Episode_#42_Interview',
            title: 'Audio Custom Name'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          assertTrue(path.basename(job.filename).includes('Podcast_Episode_'));
          assertTrue(job.filename.endsWith('.mp3'));
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'P08: Stream-Copy Fast Path + Custom Name Sanitization (Features 10 + 4)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3308 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/1080p.mp4'),
            custom_name: 'Quick_1080p_Export',
            title: 'Fastpath Rename'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          assertTrue(path.basename(job.filename).startsWith('Quick_1080p_Export'));
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'P09: Stream-Copy Fast Path + Section Trimming (Features 10 + 6)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3309 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/1080p.mp4'),
            trim_start: '00:00:00',
            trim_end: '00:00:01',
            title: 'Fastpath Trim'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          assertTrue(fs.existsSync(job.filename));
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'P10: Non-YouTube Source + Standalone MP3 Extraction (Features 3 + 5)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3310 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: true,
            title: 'Non-YT Audio Extraction'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          assertTrue(job.filename.endsWith('.mp3'));
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'P11: Non-YouTube Source + Faststart MP4 Video Output (Features 3 + 9)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3311 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/1080p.mp4'),
            title: 'Non-YT Video Faststart'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          assertTrue(isFaststart(job.filename));
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'P12: Non-YouTube Source + Section Trimming (Features 3 + 6)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3312 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/1080p.mp4'),
            trim_start: '00:00:00',
            trim_end: '00:00:01',
            title: 'Non-YT Trim'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'P13: 4K Download + Mid-Stream Cancellation + Fragment Cleanup (Features 8 + 12)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3313 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/slow'),
            title: '4K Cancel Cleanup'
          });

          await new Promise(r => setTimeout(r, 600));
          const delRes = await server.delete(`/api/queue/${addRes.body.id}`);
          assertEquals(delRes.status, 200);

          await new Promise(r => setTimeout(r, 1000));
          const files = fs.readdirSync(server.downloadDir);
          const hasFragments = files.some(f => f.endsWith('.part') || /\.f\d+\./.test(f));
          assertFalse(hasFragments, 'Intermediate fragments should be purged on cancel');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'P14: Audio Extraction + Mid-Stream Cancellation + Cleanup (Features 5 + 12)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3314 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/slow'),
            audio_only: true,
            title: 'Audio Cancel Cleanup'
          });

          await new Promise(r => setTimeout(r, 600));
          const delRes = await server.delete(`/api/queue/${addRes.body.id}`);
          assertEquals(delRes.status, 200);

          await new Promise(r => setTimeout(r, 1000));
          const files = fs.readdirSync(server.downloadDir);
          const hasFragments = files.some(f => f.endsWith('.part'));
          assertFalse(hasFragments);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'P15: Invalid Format Request + Error Status Feedback (Features 11 + 13)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3315 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/1080p.mp4'),
            format_id: 'non_existent_format_id_99999',
            title: 'Invalid Format Test'
          });

          const job = await server.waitForJob(addRes.body.id, 25000);
          assertEquals(job.status, 'error');
          assertTrue(typeof job.error === 'string' && job.error.length > 0);
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'P16: Non-Existent URL + Prompt Error Detection (Features 3 + 11)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3316 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/404-missing-file.mp4'),
            title: '404 Immediate Fail'
          });

          const job = await server.waitForJob(addRes.body.id, 25000);
          assertEquals(job.status, 'error');
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'P17: Concurrent 4K Video and MP3 Audio Downloads (Features 8 + 5 + 13)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3317, env: { MAX_CONCURRENT: '2' } });
        await server.start();

        try {
          const resVideo = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/4k.webm'),
            title: 'Concurrent 4K Video'
          });

          const resAudio = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: true,
            title: 'Concurrent MP3 Audio'
          });

          const jobVideo = await server.waitForJob(resVideo.body.id, 45000);
          const jobAudio = await server.waitForJob(resAudio.body.id, 45000);

          assertEquals(jobVideo.status, 'done');
          assertEquals(jobAudio.status, 'done');
          assertTrue(jobVideo.filename.endsWith('.mp4'));
          assertTrue(jobAudio.filename.endsWith('.mp3'));
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'P18: Video Download + History Storage + Rename via API (Features 9 + 13)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3318 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/1080p.mp4'),
            title: 'Rename Flow Test'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');

          const renameRes = await server.patch(`/api/download/${job.id}/name`, { name: 'Renamed_Video_Clip' });
          assertEquals(renameRes.status, 200);

          const histRes = await server.get('/api/history');
          const histItem = histRes.body.find(h => h.id === job.id);
          assertTrue(!!histItem);
          assertTrue(histItem.filename.includes('Renamed_Video_Clip'));
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'P19: Audio Download + History Persistence + Delete via API (Features 5 + 12 + 13)',
      run: async () => {
        const mock = new MockMediaServer();
        await mock.start();
        const server = new TestServer({ port: 3319 });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: mock.getUrl('/media/audio.webm'),
            audio_only: true,
            title: 'Delete Flow Test'
          });

          const job = await server.waitForJob(addRes.body.id, 30000);
          assertEquals(job.status, 'done');
          assertTrue(fs.existsSync(job.filename));

          const delRes = await server.delete(`/api/download/${job.id}`);
          assertEquals(delRes.status, 200);
          assertFalse(fs.existsSync(job.filename));
        } finally {
          await server.stop();
          await mock.stop();
        }
      }
    },
    {
      name: 'P20: Custom FFMPEG Binary Override + False Success Prevention Check (Features 1 + 11)',
      run: async () => {
        const server = new TestServer({
          port: 3320,
          env: { FFMPEG_PATH: '/opt/homebrew/bin/ffmpeg' }
        });
        await server.start();

        try {
          const addRes = await server.post('/api/queue/add', {
            url: 'https://example.com/bad-url',
            title: 'False Success Check'
          });

          const job = await server.waitForJob(addRes.body.id, 20000);
          assertEquals(job.status, 'error');
        } finally {
          await server.stop();
        }
      }
    }
  ]
};
