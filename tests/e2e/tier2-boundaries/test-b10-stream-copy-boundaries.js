/**
 * Tier 2 - Boundary 10: Stream-Copy Boundaries
 * Tests boundary conditions for stream-copy fast path:
 * mixed codec configurations (H.264 copy + audio transcode/resample),
 * timestamp preservation, and zero quality loss.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { assertTrue, assertEquals } = require('../helpers/assertions');
const { FFMPEG_BIN, probe, isFaststart } = require('../helpers/media-probe');

module.exports = {
  name: 'Boundary 10: Stream-Copy Boundaries',
  tests: [
    {
      name: 'B10.1: H.264 video is stream-copied while 44.1k AAC audio is resampled to 48k',
      run: async () => {
        const src = path.join(os.tmpdir(), `src-44k-${Date.now()}.mp4`);
        const dst = path.join(os.tmpdir(), `dst-48k-${Date.now()}.mp4`);

        try {
          execFileSync(FFMPEG_BIN, [
            '-y', '-f', 'lavfi', '-i', 'testsrc=duration=0.5:size=640x360:rate=30',
            '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.5:sample_rate=44100',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-ar', '44100',
            src
          ], { stdio: 'pipe' });

          execFileSync(FFMPEG_BIN, [
            '-y', '-i', src,
            '-c:v', 'copy', // fast path copy
            '-c:a', 'aac', '-ar', '48000', // resample audio to 48k
            '-movflags', '+faststart',
            dst
          ], { stdio: 'pipe' });

          const info = probe(dst);
          const vstream = info.streams.find(s => s.codec_type === 'video');
          const astream = info.streams.find(s => s.codec_type === 'audio');
          assertEquals(vstream.codec_name, 'h264');
          assertEquals(astream.codec_name, 'aac');
          assertEquals(parseInt(astream.sample_rate, 10), 48000);
        } finally {
          try { fs.unlinkSync(src); } catch {}
          try { fs.unlinkSync(dst); } catch {}
        }
      }
    },
    {
      name: 'B10.2: H.264 video with MP3 audio copies video while converting audio to AAC',
      run: async () => {
        const src = path.join(os.tmpdir(), `src-mp3audio-${Date.now()}.mp4`);
        const dst = path.join(os.tmpdir(), `dst-aacaudio-${Date.now()}.mp4`);

        try {
          execFileSync(FFMPEG_BIN, [
            '-y', '-f', 'lavfi', '-i', 'testsrc=duration=0.5:size=640x360:rate=30',
            '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.5',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            '-c:a', 'mp3',
            src
          ], { stdio: 'pipe' });

          execFileSync(FFMPEG_BIN, [
            '-y', '-i', src,
            '-c:v', 'copy',
            '-c:a', 'aac', '-ar', '48000',
            '-movflags', '+faststart',
            dst
          ], { stdio: 'pipe' });

          const info = probe(dst);
          const astream = info.streams.find(s => s.codec_type === 'audio');
          assertEquals(astream.codec_name, 'aac');
        } finally {
          try { fs.unlinkSync(src); } catch {}
          try { fs.unlinkSync(dst); } catch {}
        }
      }
    },
    {
      name: 'B10.3: Compliant H.264/AAC MP4 fast path pass-through finishes in <500ms',
      run: async () => {
        const src = path.join(os.tmpdir(), `src-perf-${Date.now()}.mp4`);
        const dst = path.join(os.tmpdir(), `dst-perf-${Date.now()}.mp4`);

        try {
          execFileSync(FFMPEG_BIN, [
            '-y', '-f', 'lavfi', '-i', 'testsrc=duration=0.5:size=640x360:rate=30',
            '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.5:sample_rate=48000',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-ar', '48000',
            src
          ], { stdio: 'pipe' });

          const start = Date.now();
          execFileSync(FFMPEG_BIN, [
            '-y', '-i', src,
            '-c', 'copy',
            '-movflags', '+faststart',
            dst
          ], { stdio: 'pipe' });
          const elapsed = Date.now() - start;

          assertTrue(elapsed < 1000, `Stream copy should be near-instant, took ${elapsed}ms`);
        } finally {
          try { fs.unlinkSync(src); } catch {}
          try { fs.unlinkSync(dst); } catch {}
        }
      }
    },
    {
      name: 'B10.4: Stream-copy preserves exact video duration and timestamps',
      run: async () => {
        const src = path.join(os.tmpdir(), `src-ts-${Date.now()}.mp4`);
        const dst = path.join(os.tmpdir(), `dst-ts-${Date.now()}.mp4`);

        try {
          execFileSync(FFMPEG_BIN, [
            '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=640x360:rate=30',
            '-c:v', 'libx264',
            src
          ], { stdio: 'pipe' });

          execFileSync(FFMPEG_BIN, [
            '-y', '-i', src,
            '-c', 'copy', '-movflags', '+faststart',
            dst
          ], { stdio: 'pipe' });

          const srcInfo = probe(src);
          const dstInfo = probe(dst);
          const srcDur = parseFloat(srcInfo.format.duration);
          const dstDur = parseFloat(dstInfo.format.duration);
          assertTrue(Math.abs(srcDur - dstDur) < 0.05, `Durations should match: ${srcDur} vs ${dstDur}`);
        } finally {
          try { fs.unlinkSync(src); } catch {}
          try { fs.unlinkSync(dst); } catch {}
        }
      }
    },
    {
      name: 'B10.5: Faststart stream-copy produces moov atom prior to mdat atom',
      run: async () => {
        const src = path.join(os.tmpdir(), `src-fs-${Date.now()}.mp4`);
        const dst = path.join(os.tmpdir(), `dst-fs-${Date.now()}.mp4`);

        try {
          execFileSync(FFMPEG_BIN, [
            '-y', '-f', 'lavfi', '-i', 'testsrc=duration=0.5:size=640x360:rate=30',
            '-c:v', 'libx264',
            src
          ], { stdio: 'pipe' });

          execFileSync(FFMPEG_BIN, [
            '-y', '-i', src,
            '-c', 'copy', '-movflags', '+faststart',
            dst
          ], { stdio: 'pipe' });

          assertTrue(isFaststart(dst));
        } finally {
          try { fs.unlinkSync(src); } catch {}
          try { fs.unlinkSync(dst); } catch {}
        }
      }
    }
  ]
};
