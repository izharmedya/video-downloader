# Project: Video Downloader

## Architecture
- **Server & Download Engine**: `server.js` (Express backend, in-memory queue manager, binary resolver, yt-dlp child process coordinator, ffmpeg media transcoding pipeline, stream validator).
- **Client & User Interface**: `public/` (`index.html`, `app.js`, `style.css`) providing responsive UI, format/quality selectors, real-time progress tracking, error alerts, and history view.
- **Media Transcoding Pipeline**: Native `arm64` FFmpeg / FFprobe (`/opt/homebrew/bin/ffmpeg`) executing H.264/AAC transcoding and MP3 tagging.
- **E2E Testing Suite**: `tests/e2e/` (opaque-box automated test harness covering Tiers 1-4 and Tier 5 adversarial stress testing).
- **Persistence**: `downloads/history.json` tracking completed downloads.

## Code Layout
- `server.js`: Monolithic Express server, API routes, process management, yt-dlp invocation, ffmpeg transcoding pipeline, validation logic.
- `public/app.js`: Frontend controller, status polling, error handling, UI state management.
- `public/index.html`: Web interface structure, quality options, queue list, error banners.
- `public/style.css`: Visual design, responsive layout, status badges, progress styling.
- `tests/e2e/`: Test runner, test suites (Tiers 1-5), assertions, media probes.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Binary Resolution & Execution Check | Detect and verify binary executability (rejecting x86_64 binaries on arm64), bind `FFMPEG_PATH` to `/opt/homebrew/bin/ffmpeg` | M1 | Survey |
| 2 | PATH Inheritance & Subprocess Env | Augment child process `PATH` in `spawnProcess` so GUI launcher (`Video İndirici.app`) reliably finds system/homebrew binaries | M1 | Survey |
| 3 | Non-YouTube Retry Optimization | Optimize `/api/info` to avoid running 7 sequential YouTube player client attempts on non-YouTube domains | M1 | Survey |
| 4 | Shell Command Injection Hardening | Replace unescaped `execSync` template literals (`osascript`, `open`) with parameterized `execFileSync` | M1 | Survey |
| 5 | Standalone Audio Extraction (MP3) | Standardize audio downloads to MP3 via `libmp3lame`, 320k CBR / V0, 44.1 kHz, ID3v2.3 tags (`-id3v2_version 3 -write_id3v1 1`) | M1 | Survey |
| 6 | Audio Trimming & Playback Speed | Fix audio section trimming and playback speed acceleration using working FFmpeg pipeline | M1 | Survey |
| 7 | Universal Audio Playback | Ensure all standalone audio downloads open and play in QuickTime, Apple Music, and VLC without decoding errors | M1 | Survey |
| 8 | 4K & High-Res Stream Extraction | Fetch genuine 2160p (4K) and 1440p (2K) video streams combined with audio streams without falling back | M1 | Survey |
| 9 | Premiere Pro Video Compatibility | Ensure all downloaded videos import smoothly into Adobe Premiere Pro by transcoding VP9/AV1 to H.264 High 5.1 (`yuv420p`) + AAC-LC 48kHz in MP4 container with `-movflags +faststart` | M1 | Survey |
| 10 | Stream-Copy Fast Path for H.264/AAC | Pass through native H.264/AAC streams (e.g. <=1080p) via stream copy (`-c copy`) with faststart for zero quality loss and near-instant processing | M1 | Survey |
| 11 | False Success Logic Remediation | Remove `code === 0 || fileExistsAndValid` bypass in `server.js:414`; verify streams via `ffprobe` before marking jobs `done` | M1 | Survey |
| 12 | Intermediate File Cleanup | Purge orphaned `.f*.mp4`, `.f*.m4a`, and `.part` fragments upon download failure or job cancellation | M1 | Survey |
| 13 | UI Status Feedback & Error Reporting | Provide clear UI error messages, degraded download warnings, and job status updates | M2 | Survey |
| 14 | E2E Test Suite Validation & Hardening | Pass 100% of comprehensive E2E tests (Tiers 1-4) followed by Tier 5 adversarial hardening | M3 | Survey |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Download Engine & Media Pipeline (`server.js`) | Features 1-12: Binary resolution, 4K stream extraction, Premiere Pro H.264/AAC transcoding, standalone MP3 audio, false success fix, stream validation, cleanup | none | DONE |
| M2 | Client UI & Error Reporting (`public/`) | Feature 13: UI error notifications, job failure feedback, degraded stream alerts, format selector clarity | M1 | DONE |
| M3 | E2E Integration & Adversarial Hardening (`tests/e2e/`) | Feature 14: 100% pass of E2E test suite (Tiers 1-4) + Tier 5 adversarial stress testing | M1, M2 | DONE |

## Interface Contracts
### Binary Resolver Contract
- `resolveExecutableBinary(envKey, candidates, preferredPaths)`: Must execute `--version` or `-version` on candidate before returning path. If candidate fails or throws `bad CPU type`, candidate is rejected.
- Default `FFMPEG_PATH` must resolve to verified working binary (e.g. `/opt/homebrew/bin/ffmpeg`).

### Video Download Output Contract
- Container: `.mp4`
- Video Stream: H.264 (`avc1`), Pixel Format `yuv420p`, Profile High, Level <= 5.2
- Audio Stream: AAC-LC (`mp4a`), 48000 Hz, stereo
- Metadata: `moov` atom at file beginning (`-movflags +faststart`)
- Height for 4K requests: `>= 2160` pixels

### Audio Download Output Contract
- Container: `.mp3`
- Audio Stream: MP3 (`libmp3lame`), 44100 Hz, stereo, Bitrate >= 192 kbps (default 320 kbps)
- Metadata Tagging: ID3v2.3 (`ID3\x03`), no conflicting MP4 container tags

### Job Completion Contract
- Job status `done` is ONLY allowed if `code === 0` AND file exists AND `ffprobe` validates the expected stream types (video has video stream, audio has audio stream).
- If `code !== 0` or stream validation fails, job status MUST be `error`.
