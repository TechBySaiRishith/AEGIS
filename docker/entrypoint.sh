#!/bin/sh
set -e

# Start the Hono API server on port 3001 (internal only)
PORT=3001 node apps/api/dist/index.js &

# Start the Next.js frontend on port 5555 (public)
PORT=5555 exec node apps/web/server.js
