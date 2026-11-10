# E2E Test Infrastructure Documentation

**Application**: Video Downloader  
**Document**: `TEST_INFRA.md`  
**Location**: `/Users/izharmedya/Desktop/Uygulamalarım/VideoDownloader/TEST_INFRA.md`  
**Test Suite Path**: `/Users/izharmedya/Desktop/Uygulamalarım/VideoDownloader/tests/e2e/`  
**Master Runner**: `node tests/e2e/runner.js`  
**Author**: Teamwork Test Writer (`teamwork_test_writer`)  

---

## 1. Executive Summary

This document describes the architecture, methodology, implementation, and execution protocols of the comprehensive **Opaque-Box End-to-End (E2E) Test Infrastructure** created for the Video Downloader application.

The test infrastructure exercises the application strictly as an external API consumer and NLE editor would:
1. Interacting over HTTP REST endpoints (`/api/info`, `/api/queue/add`, `/api/queue`, `/api/download/:id`, `/api/history`, etc.).
2. Monitoring process coordination and lifecycle (queue state transitions, speed-up postprocessing, cancellation, cleanup).
3. Validating resulting media outputs using native ARM64 `ffprobe` inspection, custom binary MP4 atom parsing (`ftyp`, `moov`, `mdat`), and audio decoder stress testing against Apple QuickTime, Apple Music, and Adobe Premiere Pro standards.

---

## 2. 4-Tier Test Suite Hierarchy

The test suite is structured into four distinct, progressive tiers totaling **167 automated test cases**:

```
tests/e2e/
├── runner.js                           # Master CLI Test Runner
├── helpers/
│   ├── assertions.js                   # Zero-dependency Assertion Framework
│   ├── media-probe.js                  # ffprobe Inspector, MP4 Atom Parser, ID3 Validator
│   ├── media-generator.js              # Synthetic Media Fixture Generator
│   ├── mock-media-server.js            # Local HTTP Streaming Server with Byte-Range support
│   └── test-server.js                  # Isolated Express Test Server Harness
├── tier1-features/                     # Tier 1: 14 Feature Suites (70 test cases)
│   ├── test-f01-binary-resolution.js
│   ├── test-f02-path-inheritance.js
│   ├── test-f03-non-youtube-retry.js
│   ├── test-f04-shell-injection.js
│   ├── test-f05-standalone-audio.js
│   ├── test-f06-audio-trim-speed.js
│   ├── test-f07-universal-audio.js
│   ├── test-f08-4k-stream-extraction.js
│   ├── test-f09-premiere-pro-compat.js
│   ├── test-f10-stream-copy-fastpath.js
│   ├── test-f11-false-success-remediation.js
│   ├── test-f12-intermediate-cleanup.js
│   ├── test-f13-ui-status-feedback.js
│   └── test-f14-e2e-validation.js
├── tier2-boundaries/                   # Tier 2: 14 Boundary Suites (70 test cases)
│   ├── test-b01-binary-boundaries.js
│   ├── test-b02-path-boundaries.js
│   ├── test-b03-network-boundaries.js
│   ├── test-b04-injection-boundaries.js
│   ├── test-b05-audio-boundaries.js
│   ├── test-b06-trim-speed-boundaries.js
│   ├── test-b07-metadata-boundaries.js
│   ├── test-b08-resolution-boundaries.js
│   ├── test-b09-premiere-boundaries.js
│   ├── test-b10-stream-copy-boundaries.js
│   ├── test-b11-failure-boundaries.js
│   ├── test-b12-cleanup-boundaries.js
│   ├── test-b13-queue-boundaries.js
│   └── test-b14-runner-boundaries.js
├── tier3-pairwise/                     # Tier 3: Cross-Feature Interactions (20 test cases)
│   └── test-pairwise-combinations.js
└── tier4-scenarios/                    # Tier 4: Real-World User Scenarios (7 test cases)
    └── test-real-world-scenarios.js
```

### 2.1 Tier Breakdown

| Tier | Category | Test Files | Test Cases | Objective |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1** | **Feature Coverage** | 14 files | 70 tests (5 per feature) | Baseline contract verification for each of the 14 features in `PROJECT.md` |
| **Tier 2** | **Boundary & Corner Cases** | 14 files | 70 tests (5 per feature) | Edge inputs, malformed parameters, resource limits, network errors, unexpected formats |
| **Tier 3** | **Pairwise Combinations** | 1 file | 20 tests | Matrix of 20 cross-feature interactions (4K+trim, 4K+speed, audio+trim+speed, cancel+cleanup, etc.) |
| **Tier 4** | **Real-World Scenarios** | 1 file | 7 tests | Realistic end-user journeys (Premiere Pro 4K workflow, Podcast audio extraction, Batch queues, etc.) |
| **Total** | | **30 files** | **167 tests** | Comprehensive end-to-end verification |

---

## 3. Test Harness & Helper Infrastructure

### 3.1 `helpers/media-probe.js`
The media probe helper enforces strict technical criteria derived directly from Adobe Premiere Pro and Apple media framework documentation:
- **`probe(filePath)`**: Executes `/opt/homebrew/bin/ffprobe` to query stream codecs, profiles, pixel formats, sample rates, and bitrates in structured JSON.
- **`parseMp4Atoms(filePath)`**: Custom binary parser scanning 32-bit and 64-bit MP4 atom headers (`ftyp`, `free`, `mdat`, `moov`).
- **`isFaststart(filePath)`**: Confirms `moov` atom offset is less than `mdat` offset, ensuring `-movflags +faststart` was applied.
- **`readId3Header(filePath)`**: Reads the first 10 bytes of an MP3 file to confirm ID3v2.3 compliance (`ID3\x03`).
- **`verifyDecoding(filePath)`**: Passes the media file through FFmpeg's null sink (`-f null -`) to confirm zero decoding errors, corrupt macroblocks, or broken packets.
- **`assertPremiereProCompatible(filePath)`**:
  - Container format: `mp4` or `mov`
  - Video stream: `h264`, `yuv420p`, High profile (level <= 5.2)
  - Audio stream: `aac`, 48000 Hz, stereo
  - Metadata: Faststart `moov` atom before `mdat`
- **`assertStandaloneMp3Compatible(filePath)`**:
  - Container format: `mp3`
  - Audio stream: `mp3` (libmp3lame), 44100 Hz, bitrate >= 192 kbps
  - Metadata: Clean ID3v2.3 header, zero container brand leakage (`major_brand=mp42` stripped)
- **`assert4KResolution(filePath)`**: Confirms video stream height `>= 2160` pixels and width `>= 3840` pixels.

### 3.2 `helpers/mock-media-server.js`
To guarantee tests are **deterministic, ultra-fast, and completely independent of external YouTube rate limits or network flakiness**, a local HTTP mock media server serves generated media fixtures:
- Serves 4K VP9 WebM (`/media/4k.webm`), 1080p H.264 MP4 (`/media/1080p.mp4`), Opus WebM (`/media/audio.webm`), and MP3 (`/media/audio.mp3`).
- Fully supports HTTP Range requests (`bytes=start-end`), enabling `yt-dlp` to download media segments exactly as it would from a production CDN.
- Provides test endpoints for error simulation: `/media/empty` (0 bytes), `/media/corrupt` (garbage bytes), `/media/500` (server error), `/media/slow` (cancellation stress test), and `/media/redirect` (HTTP 302).

### 3.3 `helpers/test-server.js`
Spawns an isolated, ephemeral instance of `server.js`:
- Binds to an unused dynamic port (e.g., 3200–3360).
- Directs downloads to an isolated temporary directory (`/tmp/video-dl-test-...`).
- Sets `IZ_LOCAL=1` to allow automated API interaction.
- Provides unified API methods: `get()`, `post()`, `patch()`, `delete()`, and `waitForJob(jobId, timeoutMs)` for asynchronous queue polling.
- Completely kills child processes and cleans up temporary downloads upon test suite teardown.

### 3.4 `helpers/media-generator.js`
Generates lightweight synthetic video/audio test fixtures on-demand using native ARM64 FFmpeg:
- Generates 1-second 1080p H.264/AAC videos in ~40 milliseconds.
- Generates 0.5-second 4K VP9/Opus videos in ~600 milliseconds.
- Generates compliant ID3v2.3 MP3 sine-wave audio in ~30 milliseconds.
- Uses parameter-keyed fixture caching in `os.tmpdir()` for near-instant repeat runs.

### 3.5 `helpers/assertions.js`
A self-contained assertion module providing informative error reporting with structured failure objects (`actual`, `expected`, `operator`), diffs, and async rejection assertions (`assertRejects`).

---

## 4. How to Run the Tests

The test suite can be run directly via Node.js without third-party test runners:

### Run All Tiers (Full E2E Suite)
```bash
node tests/e2e/runner.js
```

### Run by Specific Tier
```bash
# Tier 1: Feature Coverage (70 tests)
node tests/e2e/runner.js --tier=1

# Tier 2: Boundary & Corner Cases (70 tests)
node tests/e2e/runner.js --tier=2

# Tier 3: Pairwise Combinations (20 tests)
node tests/e2e/runner.js --tier=3

# Tier 4: Real-World Application Scenarios (7 tests)
node tests/e2e/runner.js --tier=4

# Multiple Tiers
node tests/e2e/runner.js --tier=1,3
```

### Filter Tests by Name / Pattern
```bash
# Run only 4K related tests
node tests/e2e/runner.js --filter="4K"

# Run only Premiere Pro compatibility tests
node tests/e2e/runner.js --filter="Premiere"

# Run only shell injection tests
node tests/e2e/runner.js --filter="injection"
```

### Fast-Fail Mode (Bail)
```bash
node tests/e2e/runner.js --bail
```

---

## 5. Authoritative Expected Output Specifications

Every assertion in this test suite is anchored to an explicit, authoritative specification:

### Adobe Premiere Pro Compatibility (Feature 9)
- **Container**: MP4 (`mov,mp4,m4a,3gp,3g2,mj2`).
- **Video Codec**: H.264 (`avc1`).
- **Pixel Format**: Strictly `yuv420p` (8-bit 4:2:0 planar; Premiere fails on `yuv444p` or VP9/AV1).
- **Profile**: High Profile (or Main).
- **Audio Codec**: AAC-LC (`mp4a`).
- **Sample Rate**: Strictly `48000 Hz` (video timeline standard).
- **Atom Structure**: `moov` atom located before `mdat` (`isFaststart() === true`).

### Standalone MP3 Audio Playback (Features 5 & 7)
- **Container**: MP3.
- **Audio Codec**: `mp3` via `libmp3lame`.
- **Sample Rate**: `44100 Hz`.
- **Bitrate**: `>= 192000 bps` (default `320 kbps`).
- **Tag Header**: ID3v2.3 (`ID3\x03`), never ID3v2.4 (QuickTime rejection).
- **Tag Sanitization**: No leaked MP4 container brands (`major_brand=mp42` stripped).

### 4K Resolution (Feature 8)
- **Stream Height**: `>= 2160` pixels.
- **Stream Width**: `>= 3840` pixels.
- **Streams**: Must contain both video and audio streams (never audio-only fallback).

### Job Completion Contract (Feature 11)
- Job status `done` is ONLY valid if child process `code === 0` AND file exists AND `ffprobe` validates expected streams.
- Any non-zero exit code or stream validation failure MUST set job status to `error`.

---

## 6. Integration with Project Lifecycles

This test suite is published and permanently maintained under `tests/e2e/`. During development milestones (M1: Download Engine, M2: Client UI, M3: Final Hardening), the test runner serves as the objective quality oracle for the implementing agent and lead orchestrator.
