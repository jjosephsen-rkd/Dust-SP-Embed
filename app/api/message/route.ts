import { NextRequest, NextResponse } from 'next/server';
import { getDustClient } from '@/lib/dustClient';

export async function POST(request: NextRequest) {
  try {
    const { conversationId, message } = await request.json();
    const dust = getDustClient();

    const result = await dust.postUserMessage({
      conversationId,
      message: {
        content: message,
        mentions: [{ configurationId: process.env.DUST_AGENT_ID! }],
        context: {
          username: 'web_user',
          timezone: 'UTC',
          fullName: 'Web User',
          email: null,
          profilePictureUrl: null,
          origin: 'api',
        },
      },
    });

    if (result.isErr()) {
      console.error('postUserMessage error:', result.error);
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    return NextResponse.json({ messageId: result.value.sId });
  } catch (err) {
    console.error('message route error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
