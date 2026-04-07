import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const conversationId = request.nextUrl.searchParams.get('conversationId');

  const dustRes = await fetch(
    `${process.env.DUST_API_BASE_URL}/w/${process.env.DUST_WORKSPACE_ID}/assistant/conversations/${conversationId}/events`,
    {
      headers: {
        'Authorization': `Bearer ${process.env.DUST_API_KEY}`,
      },
    }
  );

  if (!dustRes.ok || !dustRes.body) {
    return new Response(
      `data: ${JSON.stringify({ error: `Dust events error ${dustRes.status}` })}\n\n`,
      { status: dustRes.ok ? 500 : dustRes.status, headers: { 'Content-Type': 'text/event-stream' } }
    );
  }

  // Tee the stream so we can log the raw SSE for debugging
  const [streamForClient, streamForLog] = dustRes.body.tee();

  (async () => {
    const reader = streamForLog.getReader();
    const decoder = new TextDecoder();
    let log = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      log += decoder.decode(value, { stream: true });
    }
    console.log('Dust raw SSE:\n', log.slice(0, 2000));
  })();

  return new Response(streamForClient, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
