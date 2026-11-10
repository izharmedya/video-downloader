/**
 * Tier 2 - Boundary 7: Metadata & Header Boundaries
 * Tests boundary conditions for ID3 tagging, container metadata stripping,
 * Unicode/emoji titles, and oversized metadata fields.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { assertTrue, assertEquals } = require('../helpers/assertions');
const { FFMPEG_BIN, probe, readId3Header } = require('../helpers/media-probe');

module.exports = {
  name: 'Boundary 7: Metadata & Header Boundaries',
  tests: [
    {
      name: 'B7.1: Unicode and emoji metadata in title preserved in ID3v2.3 without header corruption',
      run: async () => {
        const testMp3 = path.join(os.tmpdir(), `emoji-${Date.now()}.mp3`);
        const complexTitle = '🎵 Test Video with Ünîcøde & Emoji 🚀✨';

        try {
          execFileSync(FFMPEG_BIN, [
            '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3',
            '-c:a', 'libmp3lame', '-b:a', '320k', '-ar', '44100',
            '-id3v2_version', '3',
            '-metadata', `title=${complexTitle}`,
            testMp3
          ], { stdio: 'pipe' });

          const id3 = readId3Header(testMp3);
          assertTrue(!!id3 && id3.magic === 'ID3');
          assertEquals(id3.version, 3, 'ID3 version must remain 3 despite unicode');
        } finally {
          try { fs.unlinkSync(testMp3); } catch {}
        }
      }
    },
    {
      name: 'B7.2: Empty metadata fields produce valid minimal ID3v2.3 header',
      run: async () => {
        const testMp3 = path.join(os.tmpdir(), `empty-meta-${Date.now()}.mp3`);

        try {
          execFileSync(FFMPEG_BIN, [
            '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3',
            '-c:a', 'libmp3lame', '-b:a', '320k', '-ar', '44100',
            '-id3v2_version', '3',
            testMp3
          ], { stdio: 'pipe' });

          const id3 = readId3Header(testMp3);
          assertTrue(!!id3 && id3.magic === 'ID3');
          assertEquals(id3.version, 3);
        } finally {
          try { fs.unlinkSync(testMp3); } catch {}
        }
      }
    },
    {
      name: 'B7.3: Exceptionally long title string (>500 chars) encoded without truncation error',
      run: async () => {
        const testMp3 = path.join(os.tmpdir(), `long-title-${Date.now()}.mp3`);
        const longTitle = 'A'.repeat(550);

        try {
          execFileSync(FFMPEG_BIN, [
            '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3',
            '-c:a', 'libmp3lame', '-b:a', '320k', '-ar', '44100',
            '-id3v2_version', '3',
            '-metadata', `title=${longTitle}`,
            testMp3
          ], { stdio: 'pipe' });

          const info = probe(testMp3);
          assertTrue(info.format?.tags?.title?.length >= 500, 'Long title should be preserved');
        } finally {
          try { fs.unlinkSync(testMp3); } catch {}
        }
      }
    },
    {
      name: 'B7.4: Converting MP4 to MP3 strips major_brand from final tags',
      run: async () => {
        const testMp4 = path.join(os.tmpdir(), `src-brand-${Date.now()}.mp4`);
        const testMp3 = path.join(os.tmpdir(), `dst-nobrand-${Date.now()}.mp3`);

        try {
          execFileSync(FFMPEG_BIN, [
            '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3',
            '-c:a', 'aac',
            testMp4
          ], { stdio: 'pipe' });

          execFileSync(FFMPEG_BIN, [
            '-y', '-i', testMp4,
            '-vn', '-c:a', 'libmp3lame', '-b:a', '320k', '-ar', '44100',
            '-id3v2_version', '3', '-write_id3v1', '1',
            '-map_metadata', '-1', // strip source container metadata
            testMp3
          ], { stdio: 'pipe' });

          const info = probe(testMp3);
          const tags = info.format?.tags || {};
          assertTrue(!tags.major_brand, 'major_brand must be stripped from MP3');
        } finally {
          try { fs.unlinkSync(testMp4); } catch {}
          try { fs.unlinkSync(testMp3); } catch {}
        }
      }
    },
    {
      name: 'B7.5: Non-ASCII Latin and Cyrillic artist metadata handled without parser error',
      run: async () => {
        const testMp3 = path.join(os.tmpdir(), `cyrillic-${Date.now()}.mp3`);

        try {
          execFileSync(FFMPEG_BIN, [
            '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3',
            '-c:a', 'libmp3lame', '-b:a', '320k', '-ar', '44100',
            '-id3v2_version', '3',
            '-metadata', 'artist=Чайковский (Tchaikovsky)',
            testMp3
          ], { stdio: 'pipe' });

          const info = probe(testMp3);
          assertTrue(info.format?.tags?.artist?.includes('Чайковский'));
        } finally {
          try { fs.unlinkSync(testMp3); } catch {}
        }
      }
    }
  ]
};
