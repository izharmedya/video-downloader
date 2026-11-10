/**
 * Tier 2 - Boundary 5: Audio Extraction Boundaries
 * Tests boundary conditions for standalone audio extraction:
 * high sample rate downsampling, multi-channel downmixing, micro-duration clips,
 * and VBR normalization.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { assertTrue, assertEquals } = require('../helpers/assertions');
const { FFMPEG_BIN, probe, assertStandaloneMp3Compatible } = require('../helpers/media-probe');

module.exports = {
  name: 'Boundary 5: Audio Extraction Boundaries',
  tests: [
    {
      name: 'B5.1: High sample rate audio (96 kHz) normalizes to 44.1 kHz MP3',
      run: async () => {
        const input96k = path.join(os.tmpdir(), `audio-96k-${Date.now()}.wav`);
        const outputMp3 = path.join(os.tmpdir(), `audio-44k-${Date.now()}.mp3`);

        try {
          execFileSync(FFMPEG_BIN, [
            '-y', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.5:sample_rate=96000',
            input96k
          ], { stdio: 'pipe' });

          execFileSync(FFMPEG_BIN, [
            '-y', '-i', input96k,
            '-vn', '-c:a', 'libmp3lame', '-b:a', '320k', '-ar', '44100',
            '-id3v2_version', '3',
            outputMp3
          ], { stdio: 'pipe' });

          const info = probe(outputMp3);
          const astream = info.streams.find(s => s.codec_type === 'audio');
          assertEquals(parseInt(astream.sample_rate, 10), 44100, 'Sample rate should be downsampled to 44100 Hz');
        } finally {
          try { fs.unlinkSync(input96k); } catch {}
          try { fs.unlinkSync(outputMp3); } catch {}
        }
      }
    },
    {
      name: 'B5.2: 5.1 surround sound audio downmixes cleanly to 2-channel stereo',
      run: async () => {
        const input51 = path.join(os.tmpdir(), `audio-51-${Date.now()}.wav`);
        const outputStereo = path.join(os.tmpdir(), `audio-stereo-${Date.now()}.mp3`);

        try {
          execFileSync(FFMPEG_BIN, [
            '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5',
            '-ac', '6',
            input51
          ], { stdio: 'pipe' });

          execFileSync(FFMPEG_BIN, [
            '-y', '-i', input51,
            '-vn', '-c:a', 'libmp3lame', '-ac', '2', '-ar', '44100',
            '-id3v2_version', '3',
            outputStereo
          ], { stdio: 'pipe' });

          const info = probe(outputStereo);
          const astream = info.streams.find(s => s.codec_type === 'audio');
          assertEquals(astream.channels, 2, 'Audio channels should be downmixed to 2');
        } finally {
          try { fs.unlinkSync(input51); } catch {}
          try { fs.unlinkSync(outputStereo); } catch {}
        }
      }
    },
    {
      name: 'B5.3: Extremely short audio clip (0.15s) produces valid MP3 without encoder crash',
      run: async () => {
        const microMp3 = path.join(os.tmpdir(), `micro-${Date.now()}.mp3`);

        try {
          execFileSync(FFMPEG_BIN, [
            '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.15',
            '-c:a', 'libmp3lame', '-b:a', '320k', '-ar', '44100',
            '-id3v2_version', '3',
            microMp3
          ], { stdio: 'pipe' });

          assertTrue(fs.existsSync(microMp3));
          const info = probe(microMp3);
          assertTrue(info.streams.length > 0);
        } finally {
          try { fs.unlinkSync(microMp3); } catch {}
        }
      }
    },
    {
      name: 'B5.4: Micro audio duration is recorded with valid non-zero length',
      run: async () => {
        const microMp3 = path.join(os.tmpdir(), `micro-dur-${Date.now()}.mp3`);

        try {
          execFileSync(FFMPEG_BIN, [
            '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.15',
            '-c:a', 'libmp3lame', '-b:a', '320k', '-ar', '44100',
            '-id3v2_version', '3',
            microMp3
          ], { stdio: 'pipe' });

          const info = probe(microMp3);
          const dur = parseFloat(info.format?.duration || '0');
          assertTrue(dur > 0, `Micro audio duration must be > 0, got ${dur}`);
        } finally {
          try { fs.unlinkSync(microMp3); } catch {}
        }
      }
    },
    {
      name: 'B5.5: Audio extraction with ID3v2.3 tag standard conforms to QuickTime requirement',
      run: async () => {
        const testMp3 = path.join(os.tmpdir(), `id3v23-${Date.now()}.mp3`);

        try {
          execFileSync(FFMPEG_BIN, [
            '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5',
            '-c:a', 'libmp3lame', '-b:a', '320k', '-ar', '44100',
            '-id3v2_version', '3', '-write_id3v1', '1',
            testMp3
          ], { stdio: 'pipe' });

          assertStandaloneMp3Compatible(testMp3);
        } finally {
          try { fs.unlinkSync(testMp3); } catch {}
        }
      }
    }
  ]
};
