/**
 * Media Probe & Media Specification Validation Helper
 * Provides ffprobe assertions, MP4 atom parsing, ID3 header inspection,
 * and decoding verification for Premiere Pro, QuickTime, and Apple Music.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { assertTrue, assertEquals, assertGreaterThanOrEqual, assertGreaterThan, TestFailure } = require('./assertions');

function resolveProbeBinary() {
  const candidates = [
    process.env.FFPROBE_PATH,
    '/opt/homebrew/bin/ffprobe',
    '/usr/local/bin/ffprobe',
    'ffprobe'
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['-version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // try next
    }
  }
  return '/opt/homebrew/bin/ffprobe';
}

function resolveFfmpegBinary() {
  const candidates = [
    process.env.FFMPEG_PATH,
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    'ffmpeg'
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['-version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // try next
    }
  }
  return '/opt/homebrew/bin/ffmpeg';
}

const FFPROBE_BIN = resolveProbeBinary();
const FFMPEG_BIN = resolveFfmpegBinary();

/**
 * Execute ffprobe on media file and return parsed JSON
 */
function probe(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new TestFailure(`File does not exist: ${filePath}`);
  }

  try {
    const raw = execFileSync(FFPROBE_BIN, [
      '-v', 'error',
      '-show_format',
      '-show_streams',
      '-of', 'json',
      filePath
    ], { encoding: 'utf8', timeout: 15000 });

    return JSON.parse(raw);
  } catch (err) {
    throw new TestFailure(`ffprobe inspection failed on ${filePath}: ${err.message}`, {
      filePath,
      stderr: err.stderr ? err.stderr.toString() : ''
    });
  }
}

/**
 * Parse top-level atoms of an MP4 / MOV file to check atom positioning
 */
function parseMp4Atoms(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new TestFailure(`File does not exist for atom parsing: ${filePath}`);
  }

  const fd = fs.openSync(filePath, 'r');
  const stat = fs.fstatSync(fd);
  const atoms = [];
  let offset = 0;

  try {
    while (offset < stat.size) {
      const headerBuf = Buffer.alloc(8);
      const read = fs.readSync(fd, headerBuf, 0, 8, offset);
      if (read < 8) break;

      let size = headerBuf.readUInt32BE(0);
      const name = headerBuf.toString('ascii', 4, 8);

      if (size === 0) {
        // Atom extends to end of file
        atoms.push({ name, offset, size: stat.size - offset });
        break;
      }

      if (size === 1) {
        // 64-bit size
        const extBuf = Buffer.alloc(8);
        fs.readSync(fd, extBuf, 0, 8, offset + 8);
        size = Number(extBuf.readBigUInt64BE(0));
      }

      atoms.push({ name, offset, size });
      offset += size;
    }
  } finally {
    fs.closeSync(fd);
  }

  return atoms;
}

/**
 * Check if the MP4 moov atom precedes the mdat atom (+faststart enabled)
 */
function isFaststart(filePath) {
  const atoms = parseMp4Atoms(filePath);
  const moov = atoms.find(a => a.name === 'moov');
  const mdat = atoms.find(a => a.name === 'mdat');

  if (!moov || !mdat) return false;
  return moov.offset < mdat.offset;
}

/**
 * Read ID3 header bytes from MP3 file
 */
function readId3Header(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new TestFailure(`File does not exist: ${filePath}`);
  }
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(10);
  try {
    const read = fs.readSync(fd, buf, 0, 10, 0);
    if (read < 10) return null;
    const magic = buf.toString('ascii', 0, 3);
    const version = buf[3];
    const revision = buf[4];
    return { magic, version, revision };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Verify media file decodes cleanly without stream errors
 */
function verifyDecoding(filePath) {
  try {
    execFileSync(FFMPEG_BIN, [
      '-v', 'error',
      '-i', filePath,
      '-f', 'null',
      '-'
    ], { stdio: 'pipe', timeout: 30000 });
    return true;
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : err.message;
    throw new TestFailure(`Media file decoding failed: ${stderr}`, { filePath, stderr });
  }
}

/**
 * Assert file satisfies Adobe Premiere Pro compatibility criteria:
 * - Container: MP4 / MOV
 * - Video codec: H.264 (avc1)
 * - Video pixel format: yuv420p
 * - Video profile: High
 * - Audio codec: AAC-LC
 * - Audio sample rate: 48000 Hz
 * - moov atom before mdat (faststart)
 */
function assertPremiereProCompatible(filePath) {
  const info = probe(filePath);
  const formatName = info.format?.format_name || '';
  const streams = info.streams || [];

  const vstream = streams.find(s => s.codec_type === 'video');
  const astream = streams.find(s => s.codec_type === 'audio');

  assertTrue(
    formatName.includes('mp4') || formatName.includes('mov'),
    `Container format must be MP4/MOV, got ${formatName}`
  );

  assertTrue(!!vstream, 'Video stream is required in Premiere Pro output');
  assertEquals(vstream.codec_name, 'h264', `Video codec must be h264, got ${vstream.codec_name}`);
  assertEquals(vstream.pix_fmt, 'yuv420p', `Pixel format must be yuv420p, got ${vstream.pix_fmt}`);

  if (vstream.profile) {
    assertTrue(
      vstream.profile.toLowerCase().includes('high') || vstream.profile.toLowerCase().includes('main'),
      `Video profile should be High or Main, got ${vstream.profile}`
    );
  }

  assertTrue(!!astream, 'Audio stream is required in Premiere Pro output');
  assertEquals(astream.codec_name, 'aac', `Audio codec must be aac, got ${astream.codec_name}`);
  assertEquals(parseInt(astream.sample_rate, 10), 48000, `Audio sample rate must be 48000 Hz, got ${astream.sample_rate}`);

  // Atom ordering check
  assertTrue(isFaststart(filePath), 'moov atom must appear before mdat atom (+faststart)');

  // Decode check
  verifyDecoding(filePath);

  return { info, vstream, astream };
}

/**
 * Assert standalone audio satisfies universal playback criteria:
 * - Container: MP3
 * - Codec: mp3 (libmp3lame)
 * - Sample rate: 44100 Hz
 * - Bitrate >= 192 kbps
 * - ID3v2.3 header present (magic 'ID3', version 3)
 * - No MP4 container tags leaked into format tags
 */
function assertStandaloneMp3Compatible(filePath) {
  const info = probe(filePath);
  const formatName = info.format?.format_name || '';
  const streams = info.streams || [];
  const astream = streams.find(s => s.codec_type === 'audio');

  assertTrue(formatName.includes('mp3'), `Container format must be MP3, got ${formatName}`);
  assertTrue(!!astream, 'Audio stream required');
  assertEquals(astream.codec_name, 'mp3', `Audio codec must be mp3, got ${astream.codec_name}`);
  assertEquals(parseInt(astream.sample_rate, 10), 44100, `Audio sample rate must be 44100 Hz, got ${astream.sample_rate}`);

  const bitRate = parseInt(astream.bit_rate || info.format?.bit_rate || '0', 10);
  assertGreaterThanOrEqual(bitRate, 192000, `Bitrate must be >= 192000 bps, got ${bitRate}`);

  // Check ID3 header
  const id3 = readId3Header(filePath);
  assertTrue(!!id3 && id3.magic === 'ID3', `File must start with ID3 header, got ${JSON.stringify(id3)}`);
  assertEquals(id3.version, 3, `ID3 version must be 3 (ID3v2.3) for QuickTime/Music playback, got version ${id3.version}`);

  // Container tag pollution check
  const tags = info.format?.tags || {};
  assertTrue(!tags.major_brand, `ID3 tags must not contain leaked MP4 container tag major_brand: ${tags.major_brand}`);
  assertTrue(!tags.compatible_brands, `ID3 tags must not contain leaked MP4 compatible_brands: ${tags.compatible_brands}`);

  // Decode check
  verifyDecoding(filePath);

  return { info, astream, id3 };
}

/**
 * Assert video height meets 4K criteria (>= 2160 pixels)
 */
function assert4KResolution(filePath) {
  const info = probe(filePath);
  const vstream = (info.streams || []).find(s => s.codec_type === 'video');
  assertTrue(!!vstream, 'Video stream missing');
  assertGreaterThanOrEqual(vstream.height, 2160, `Height must be >= 2160 for 4K stream, got ${vstream.height}`);
  return { info, vstream };
}

module.exports = {
  FFPROBE_BIN,
  FFMPEG_BIN,
  probe,
  parseMp4Atoms,
  isFaststart,
  readId3Header,
  verifyDecoding,
  assertPremiereProCompatible,
  assertStandaloneMp3Compatible,
  assert4KResolution,
};
