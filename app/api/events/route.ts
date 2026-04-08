import { NextRequest } from 'next/server';
import { getDustClient } from '@/lib/dustClient';

export const dynamic = 'force-dynamic';

function errorStream(message: string) {
  return new Response(
    `data: ${JSON.stringify({ type: 'agent_error', error: { message } })}\n\n`,
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  );
}

export async function GET(request: NextRequest) {
  const conversationId = request.nextUrl.searchParams.get('conversationId');
  const userMessageId = request.nextUrl.searchParams.get('messageId');

  if (!conversationId || !userMessageId) {
    return errorStream('Missing conversationId or messageId');
  }

  const dust = getDustClient();

  // Fetch the full conversation object required by streamAgentAnswerEvents
  const convResult = await dust.getConversation({ conversationId });
  if (convResult.isErr()) {
    console.error('getConversation error:', convResult.error);
    return errorStream(convResult.error.message);
  }

  const streamResult = await dust.streamAgentAnswerEvents({
    conversation: convResult.value,
    userMessageId,
  });

  if (streamResult.isErr()) {
    console.error('streamAgentAnswerEvents error:', streamResult.error);
    return errorStream(streamResult.error.message);
  }

  const { eventStream } = streamResult.value;

  // Convert the SDK's AsyncIterable into an SSE ReadableStream for the client
  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const event of eventStream) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          if (
            event.type === 'agent_message_success' ||
            event.type === 'agent_error' ||
            event.type === 'user_message_error'
          ) {
            break;
          }
        }
      } catch (err) {
        console.error('event stream error:', err);
        const errEvent = { type: 'agent_error', error: { message: String(err) } };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errEvent)}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
