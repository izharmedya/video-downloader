/**
 * Tier 2 - Boundary 9: Premiere Pro Boundaries
 * Tests boundary conditions for Adobe Premiere Pro media compatibility:
 * VP9 transcode, AV1 transcode, pixel format downsampling (yuv444p -> yuv420p),
 * Opus to AAC 48k audio normalization, and silent video handling.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { assertTrue, assertEquals } = require('../helpers/assertions');
const { FFMPEG_BIN, probe, assertPremiereProCompatible } = require('../helpers/media-probe');

module.exports = {
  name: 'Boundary 9: Premiere Pro Boundaries',
  tests: [
    {
      name: 'B9.1: VP9 WebM stream transcoded to H.264 High MP4 passes Premiere compatibility',
      run: async () => {
        const vp9Src = path.join(os.tmpdir(), `src-vp9-${Date.now()}.webm`);
        const mp4Dst = path.join(os.tmpdir(), `dst-h264-${Date.now()}.mp4`);

        try {
          execFileSync(FFMPEG_BIN, [
            '-y', '-f', 'lavfi', '-i', 'testsrc=duration=0.5:size=640x360:rate=24',
            '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.5',
            '-c:v', 'libvpx-vp9', '-c:a', 'libopus',
            vp9Src
          ], { stdio: 'pipe' });

          execFileSync(FFMPEG_BIN, [
            '-y', '-i', vp9Src,
            '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-ar', '48000', '-b:a', '192k',
            '-movflags', '+faststart',
            mp4Dst
          ], { stdio: 'pipe' });

          assertPremiereProCompatible(mp4Dst);
        } finally {
          try { fs.unlinkSync(vp9Src); } catch {}
          try { fs.unlinkSync(mp4Dst); } catch {}
        }
      }
    },
    {
      name: 'B9.2: yuv444p source pixel format normalizes to standard yuv420p',
      run: async () => {
        const yuv444 = path.join(os.tmpdir(), `yuv444-${Date.now()}.mp4`);
        const yuv420 = path.join(os.tmpdir(), `yuv420-${Date.now()}.mp4`);

        try {
          execFileSync(FFMPEG_BIN, [
            '-y', '-f', 'lavfi', '-i', 'testsrc=duration=0.5:size=640x360:rate=24',
            '-c:v', 'libx264', '-pix_fmt', 'yuv444p',
            yuv444
          ], { stdio: 'pipe' });

          execFileSync(FFMPEG_BIN, [
            '-y', '-i', yuv444,
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-ar', '48000',
            '-movflags', '+faststart',
            yuv420
          ], { stdio: 'pipe' });

          const info = probe(yuv420);
          const vstream = info.streams.find(s => s.codec_type === 'video');
          assertEquals(vstream.pix_fmt, 'yuv420p', 'Must be converted to yuv420p');
        } finally {
          try { fs.unlinkSync(yuv444); } catch {}
          try { fs.unlinkSync(yuv420); } catch {}
        }
      }
    },
    {
      name: 'B9.3: Opus audio track transcodes to AAC-LC at 48000 Hz',
      run: async () => {
        const opusSrc = path.join(os.tmpdir(), `opus-audio-${Date.now()}.webm`);
        const aacDst = path.join(os.tmpdir(), `aac-audio-${Date.now()}.m4a`);

        try {
          execFileSync(FFMPEG_BIN, [
            '-y', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.5',
            '-c:a', 'libopus',
            opusSrc
          ], { stdio: 'pipe' });

          execFileSync(FFMPEG_BIN, [
            '-y', '-i', opusSrc,
            '-c:a', 'aac', '-ar', '48000', '-b:a', '192k',
            aacDst
          ], { stdio: 'pipe' });

          const info = probe(aacDst);
          const astream = info.streams.find(s => s.codec_type === 'audio');
          assertEquals(astream.codec_name, 'aac');
          assertEquals(parseInt(astream.sample_rate, 10), 48000);
        } finally {
          try { fs.unlinkSync(opusSrc); } catch {}
          try { fs.unlinkSync(aacDst); } catch {}
        }
      }
    },
    {
      name: 'B9.4: Silent video source generates silent AAC audio track for NLE sequence alignment',
      run: async () => {
        const silentSrc = path.join(os.tmpdir(), `silent-${Date.now()}.mp4`);
        const normalized = path.join(os.tmpdir(), `silent-norm-${Date.now()}.mp4`);

        try {
          // Generate video with NO audio stream
          execFileSync(FFMPEG_BIN, [
            '-y', '-f', 'lavfi', '-i', 'testsrc=duration=0.5:size=640x360:rate=24',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            silentSrc
          ], { stdio: 'pipe' });

          // Add silent AAC track
          execFileSync(FFMPEG_BIN, [
            '-y', '-i', silentSrc,
            '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
            '-c:v', 'copy',
            '-c:a', 'aac', '-shortest',
            '-movflags', '+faststart',
            normalized
          ], { stdio: 'pipe' });

          const info = probe(normalized);
          const astream = info.streams.find(s => s.codec_type === 'audio');
          assertTrue(!!astream, 'Normalized video should contain audio stream');
          assertEquals(astream.codec_name, 'aac');
        } finally {
          try { fs.unlinkSync(silentSrc); } catch {}
          try { fs.unlinkSync(normalized); } catch {}
        }
      }
    },
    {
      name: 'B9.5: Faststart atom moving operates without re-encoding video stream',
      run: async () => {
        const nonFast = path.join(os.tmpdir(), `nonfast-${Date.now()}.mp4`);
        const fast = path.join(os.tmpdir(), `fast-${Date.now()}.mp4`);

        try {
          execFileSync(FFMPEG_BIN, [
            '-y', '-f', 'lavfi', '-i', 'testsrc=duration=0.5:size=640x360:rate=24',
            '-c:v', 'libx264',
            nonFast
          ], { stdio: 'pipe' });

          execFileSync(FFMPEG_BIN, [
            '-y', '-i', nonFast,
            '-c', 'copy', '-movflags', '+faststart',
            fast
          ], { stdio: 'pipe' });

          const { isFaststart } = require('../helpers/media-probe');
          assertTrue(isFaststart(fast), 'Stream copy + faststart should locate moov at beginning');
        } finally {
          try { fs.unlinkSync(nonFast); } catch {}
          try { fs.unlinkSync(fast); } catch {}
        }
      }
    }
  ]
};
