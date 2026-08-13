#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
export PATH="/Users/izharmedya/.local/node/bin:$PATH"
cd "$DIR"

echo "=========================================="
echo "🎬 Video İndirici Sunucusu Başlatılıyor..."
echo "=========================================="

lsof -ti:3131 | xargs kill -9 2>/dev/null
sleep 1

node server.js
