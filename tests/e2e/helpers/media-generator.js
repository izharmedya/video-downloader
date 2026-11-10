/**
 * Synthetic Media Generator Helper
 * Generates compact, standard-compliant test fixtures using FFmpeg.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { FFMPEG_BIN } = require('./media-probe');

const FIXTURE_DIR = path.join(os.tmpdir(), 'video-dl-fixtures');
fs.mkdirSync(FIXTURE_DIR, { recursive: true });

function generateH264Mp4(options = {}) {
  const {
    width = 1920,
    height = 1080,
    duration = 1,
    sampleRate = 48000,
    faststart = true,
    outputPath = path.join(FIXTURE_DIR, `fixture-${width}x${height}-${sampleRate}-${faststart ? 'fast' : 'norm'}.mp4`),
  } = options;

  if (fs.existsSync(outputPath)) return outputPath;

  const args = [
    '-y',
    '-f', 'lavfi', '-i', `testsrc=duration=${duration}:size=${width}x${height}:rate=30`,
    '-f', 'lavfi', '-i', `sine=frequency=1000:duration=${duration}:sample_rate=${sampleRate}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', String(sampleRate), '-b:a', '192k',
  ];

  if (faststart) {
    args.push('-movflags', '+faststart');
  }

  args.push(outputPath);
  execFileSync(FFMPEG_BIN, args, { stdio: 'pipe' });
  return outputPath;
}

function generate4KVp9Webm(options = {}) {
  const {
    width = 3840,
    height = 2160,
    duration = 0.5,
    outputPath = path.join(FIXTURE_DIR, `fixture-${width}x${height}-vp9.webm`),
  } = options;

  if (fs.existsSync(outputPath)) return outputPath;

  const args = [
    '-y',
    '-f', 'lavfi', '-i', `testsrc=duration=${duration}:size=${width}x${height}:rate=24`,
    '-f', 'lavfi', '-i', `sine=frequency=1000:duration=${duration}`,
    '-c:v', 'libvpx-vp9', '-b:v', '100k', '-crf', '45', '-deadline', 'realtime',
    '-c:a', 'libopus', '-b:a', '64k',
    outputPath
  ];

  execFileSync(FFMPEG_BIN, args, { stdio: 'pipe' });
  return outputPath;
}

function generateOpusWebm(options = {}) {
  const {
    duration = 1,
    outputPath = path.join(FIXTURE_DIR, `fixture-opus-${duration}s.webm`),
  } = options;

  if (fs.existsSync(outputPath)) return outputPath;

  const args = [
    '-y',
    '-f', 'lavfi', '-i', `sine=frequency=880:duration=${duration}`,
    '-c:a', 'libopus', '-b:a', '96k',
    outputPath
  ];

  execFileSync(FFMPEG_BIN, args, { stdio: 'pipe' });
  return outputPath;
}

function generateMp3(options = {}) {
  const {
    duration = 1,
    bitrate = '320k',
    sampleRate = 44100,
    id3Version = 3,
    outputPath = path.join(FIXTURE_DIR, `fixture-mp3-${bitrate}-${sampleRate}-v${id3Version}.mp3`),
  } = options;

  if (fs.existsSync(outputPath)) return outputPath;

  const args = [
    '-y',
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${duration}`,
    '-c:a', 'libmp3lame', '-b:a', bitrate, '-ar', String(sampleRate),
    '-id3v2_version', String(id3Version),
    '-write_id3v1', '1',
    '-metadata', 'title=Test Sine Wave',
    '-metadata', 'artist=Fixture Generator',
    outputPath
  ];

  execFileSync(FFMPEG_BIN, args, { stdio: 'pipe' });
  return outputPath;
}

module.exports = {
  FIXTURE_DIR,
  generateH264Mp4,
  generate4KVp9Webm,
  generateOpusWebm,
  generateMp3,
};
