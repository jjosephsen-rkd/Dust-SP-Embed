import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const conversationId = request.nextUrl.searchParams.get('conversationId');

  const response = await fetch(
    `${process.env.DUST_API_BASE_URL}/w/${process.env.DUST_WORKSPACE_ID}/assistant/conversations/${conversationId}/events`,
    {
      headers: {
        'Authorization': `Bearer ${process.env.DUST_API_KEY}`,
      },
    }
  );

  return new Response(response.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
