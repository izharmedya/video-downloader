# Video Downloader

A small, self-hosted media downloader with a local web interface powered by `yt-dlp`. It runs on your Mac and keeps the download queue and files on your machine.

## Features

- Download jobs with progress and format selection.
- Optional `ffmpeg` support for combining separate audio and video streams.
- Password-protected web interface. A random password is generated and printed in the terminal when `PASSWORD` is not set.
- Configurable download folder and concurrency limit.

## Requirements

- Node.js 18 or later
- `yt-dlp` available on `PATH` (or set `YTDLP_PATH`)
- `ffmpeg` for merging formats (or set `FFMPEG_PATH`)

## Run locally

```bash
npm ci
npm start
```

Open <http://127.0.0.1:3131>. Copy the one-time password from the terminal output, or set your own `PASSWORD` before starting. You can also copy `.env.example` to `.env` and adjust the values.

## Network access

The server binds to `127.0.0.1` by default so it is available only on this computer. To allow another device on a trusted local network, set `HOST=0.0.0.0` and choose a strong `PASSWORD`. Do not expose the service directly to the public internet.

## Third-party component

The `vdhcoapp-master` directory contains the companion native host project and keeps its own license notice. Please review its license before redistributing that component.

## Responsible use

Use this tool only for content you are allowed to download and follow the rules of the source service.

## License

Original project source code is MIT-licensed. Third-party components keep their own licenses.
