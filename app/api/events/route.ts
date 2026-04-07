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

  return new Response(dustRes.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
