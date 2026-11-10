#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:/Users/izharmedya/.gemini/antigravity/bin:/Users/izharmedya/Library/Application Support/Antigravity/bin:/Users/izharmedya/.local/bin:$PATH"
export IZ_LOCAL=1
cd "$DIR"

echo "=========================================="
echo "🎬 Video İndirici Başlatılıyor..."
echo "=========================================="

lsof -ti:3131 | xargs kill -9 2>/dev/null
sleep 0.5

(sleep 1 && open "http://localhost:3131") &
node server.js
