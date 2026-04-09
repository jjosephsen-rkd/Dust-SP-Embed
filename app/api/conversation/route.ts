import { NextRequest, NextResponse } from 'next/server';
import { getDustClient } from '@/lib/dustClient';

export async function POST(request: NextRequest) {
  try {
    const { message, agentId } = await request.json();
    const dust = getDustClient();

    const result = await dust.createConversation({
      title: null,
      visibility: 'unlisted',
      message: {
        content: message,
        mentions: [{ configurationId: agentId ?? process.env.DUST_AGENT_ID! }],
        context: {
          username: 'web_user',
          timezone: 'UTC',
          fullName: 'Web User',
          email: null,
          profilePictureUrl: null,
          origin: 'api',
        },
      },
      blocking: false,
    });

    if (result.isErr()) {
      console.error('createConversation error:', result.error);
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    const { conversation, message: userMessage } = result.value;
    return NextResponse.json({
      conversationId: conversation.sId,
      messageId: userMessage?.sId,
    });
  } catch (err) {
    console.error('conversation route error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
