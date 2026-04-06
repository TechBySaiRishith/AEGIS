#!/bin/sh
set -e

# Start the Hono API server in the background
node apps/api/dist/index.js &
API_PID=$!

# Start the Next.js frontend (foreground)
exec node apps/web/server.js
