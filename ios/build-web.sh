#!/bin/sh
# Build the web UI into the app (Sources/Pager/Resources/web), calling the relative /api path that
# the app's scheme handler carries over iroh. Run it before every app build that should pick up UI changes.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
cd "$here/.."
npm run typecheck
VITE_USE_HTTP=1 npx vite build --outDir "$here/Sources/Pager/Resources/web" --emptyOutDir
