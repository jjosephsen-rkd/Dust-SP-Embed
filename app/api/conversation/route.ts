import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { message } = await request.json();

    const dustRes = await fetch(
      `${process.env.DUST_API_BASE_URL}/w/${process.env.DUST_WORKSPACE_ID}/assistant/conversations`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.DUST_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: null,
          visibility: 'unlisted',
          message: {
            content: message,
            mentions: [{ configurationId: process.env.DUST_AGENT_ID }],
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
        }),
      }
    );

    const text = await dustRes.text();
    console.log('Dust create conversation:', dustRes.status, text.slice(0, 500));

    if (!dustRes.ok) {
      return NextResponse.json(
        { error: `Dust API error ${dustRes.status}: ${text}` },
        { status: dustRes.status }
      );
    }

    const data = JSON.parse(text);
    return NextResponse.json({
      conversationId: data.conversation.sId,
      messageId: data.message.sId,
    });
  } catch (err) {
    console.error('conversation route error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
