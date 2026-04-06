/**
 * SSE proxy route — Next.js rewrites can buffer/compress SSE responses,
 * breaking real-time streaming.  This route fetches the SSE stream from
 * the Hono backend and re-emits it with the correct headers so the
 * browser receives events immediately.
 */

const API_INTERNAL = process.env.API_INTERNAL_URL || "http://localhost:3001";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const upstream = `${API_INTERNAL}/api/evaluations/${id}/events`;

  const upstreamRes = await fetch(upstream, {
    headers: { Accept: "text/event-stream" },
    // @ts-expect-error -- Node 18+ undici supports duplex streaming
    duplex: "half",
    cache: "no-store",
  });

  if (!upstreamRes.ok || !upstreamRes.body) {
    return new Response(
      JSON.stringify({ error: "Upstream SSE unavailable" }),
      { status: upstreamRes.status || 502, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(upstreamRes.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
