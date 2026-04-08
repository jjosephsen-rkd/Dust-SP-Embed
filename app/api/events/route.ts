import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const DUST_BASE = process.env.DUST_API_BASE_URL!;
const WORKSPACE_ID = process.env.DUST_WORKSPACE_ID!;
const API_KEY = process.env.DUST_API_KEY!;

const dustHeaders = {
  'Authorization': `Bearer ${API_KEY}`,
};

/**
 * Poll the conversation until we find an agent message that is a reply
 * to the given user message, then return its sId.
 */
async function findAgentMessageId(
  conversationId: string,
  userMessageId: string
): Promise<string | null> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(
      `${DUST_BASE}/w/${WORKSPACE_ID}/assistant/conversations/${conversationId}`,
      { headers: dustHeaders }
    );
    if (!res.ok) {
      console.error('Failed to fetch conversation:', res.status);
      return null;
    }
    const data = await res.json();
    const content: unknown[][] = data.conversation?.content ?? [];

    for (const messageVersions of content) {
      for (const msg of messageVersions) {
        const m = msg as Record<string, unknown>;
        if (
          m.type === 'agent_message' &&
          m.parentMessageId === userMessageId
        ) {
          console.log('Found agent message:', m.sId);
          return m.sId as string;
        }
      }
    }

    // Not found yet — wait and retry
    await new Promise((r) => setTimeout(r, 500));
  }

  console.error('Timed out waiting for agent message');
  return null;
}

export async function GET(request: NextRequest) {
  const conversationId = request.nextUrl.searchParams.get('conversationId');
  const userMessageId = request.nextUrl.searchParams.get('messageId');

  if (!conversationId || !userMessageId) {
    return new Response(
      `data: ${JSON.stringify({ type: 'agent_error', error: { message: 'Missing conversationId or messageId' } })}\n\n`,
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
    );
  }

  const agentMessageId = await findAgentMessageId(conversationId, userMessageId);

  if (!agentMessageId) {
    return new Response(
      `data: ${JSON.stringify({ type: 'agent_error', error: { message: 'Could not find agent message for conversation' } })}\n\n`,
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
    );
  }

  const url = `${DUST_BASE}/w/${WORKSPACE_ID}/assistant/conversations/${conversationId}/messages/${agentMessageId}/events`;
  console.log('Streaming events from:', url);

  const dustRes = await fetch(url, { headers: dustHeaders });

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
