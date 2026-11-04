#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "请先安装 Node.js 22.13 或更高版本：https://nodejs.org/"
  read -r -p "按回车关闭…"
  exit 1
fi
if ! node -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major>22||(major===22&&minor>=13)?0:1)'; then
  echo "鉴权系统需要 Node.js 22.13 或更高版本：https://nodejs.org/"
  read -r -p "按回车关闭…"
  exit 1
fi
if curl -fsS http://localhost:5173/health >/dev/null 2>&1; then
  open "http://localhost:5173/zh/chapters/overview"
  exit 0
fi
open "http://localhost:5173/zh/chapters/overview"
exec node server.mjs
