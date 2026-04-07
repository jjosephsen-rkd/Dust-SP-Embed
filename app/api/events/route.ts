import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const conversationId = request.nextUrl.searchParams.get('conversationId');
  const messageId = request.nextUrl.searchParams.get('messageId');

  const url = `${process.env.DUST_API_BASE_URL}/w/${process.env.DUST_WORKSPACE_ID}/assistant/conversations/${conversationId}/messages/${messageId}/events`;
  console.log('Streaming events from:', url);

  const dustRes = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${process.env.DUST_API_KEY}`,
    },
  });

  if (!dustRes.ok || !dustRes.body) {
    const text = await dustRes.text();
    console.error('Dust events error:', dustRes.status, text);
    return new Response(
      `data: ${JSON.stringify({ type: 'agent_error', error: { message: `Dust events error ${dustRes.status}: ${text}` } })}\n\n`,
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
    );
  }

  return new Response(dustRes.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
