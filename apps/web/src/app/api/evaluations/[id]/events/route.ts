/**
 * SSE proxy route — streams events from the Hono backend to the browser.
 *
 * Next.js applies gzip compression to all responses when the browser
 * sends `Accept-Encoding: gzip`.  For SSE this is fatal: gzip buffers
 * tiny events until a ~1 KB compression block fills, so the browser
 * sees nothing for minutes.
 *
 * Workaround: we prime the stream with a 2 KB SSE comment (ignored by
 * EventSource) to force the gzip compressor to emit its first block.
 * After that initial flush, every subsequent event is small enough
 * to be emitted immediately.
 */

import http from "node:http";
import { API_INTERNAL_URL } from "@/lib/env.server";

export const dynamic = "force-dynamic";

// 2 KB padding — SSE comments (lines starting with `:`) are silently
// discarded by EventSource, so this is invisible to application code.
const GZIP_FLUSH_PADDING = `: ${"\x20".repeat(2048)}\n\n`;
const encoder = new TextEncoder();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const upstream = new URL(`${API_INTERNAL_URL}/api/evaluations/${id}/events`);

  const stream = new ReadableStream({
    start(controller) {
      // Prime gzip buffer so subsequent small events flush immediately
      controller.enqueue(encoder.encode(GZIP_FLUSH_PADDING));

      const req = http.get(
        upstream,
        { headers: { Accept: "text/event-stream" } },
        (res) => {
          if (res.statusCode !== 200) {
            controller.enqueue(
              encoder.encode(
                `event: error\ndata: ${JSON.stringify({ error: "upstream " + res.statusCode })}\n\n`,
              ),
            );
            controller.close();
            return;
          }

          res.on("data", (chunk: Buffer) => {
            try {
              controller.enqueue(new Uint8Array(chunk));
            } catch {
              res.destroy();
            }
          });
          res.on("end", () => controller.close());
          res.on("error", () => controller.close());
        },
      );

      req.on("error", () => controller.close());
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
