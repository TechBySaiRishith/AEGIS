/**
 * SSE proxy route — streams events from the Hono backend to the browser.
 *
 * Next.js applies gzip compression to responses when the browser sends
 * `Accept-Encoding: gzip`. For SSE this buffers tiny events until a
 * compression block fills — the browser sees nothing for minutes.
 *
 * Industry standard fix: set `Content-Encoding: identity` to explicitly
 * opt out of compression for this route, plus a 15 s heartbeat to keep
 * the connection alive through proxies.
 */

import http from "node:http";
import { API_INTERNAL_URL } from "@/lib/env.server";

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const HEARTBEAT_INTERVAL_MS = 15_000;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const upstream = new URL(`${API_INTERNAL_URL}/api/evaluations/${id}/events`);

  const stream = new ReadableStream({
    start(controller) {
      // Keep-alive heartbeat — SSE comment lines are discarded by EventSource
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, HEARTBEAT_INTERVAL_MS);

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
            clearInterval(heartbeat);
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
          res.on("end", () => {
            clearInterval(heartbeat);
            controller.close();
          });
          res.on("error", () => {
            clearInterval(heartbeat);
            controller.close();
          });
        },
      );

      req.on("error", () => {
        clearInterval(heartbeat);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      "Content-Encoding": "identity",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
