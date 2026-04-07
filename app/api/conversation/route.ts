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
          message: {
            content: message,
            mentions: [{ configurationId: process.env.DUST_AGENT_ID }],
            context: {
              username: 'web_user',
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              fullName: 'Web User',
              origin: 'api',
            },
          },
          blocking: false,
          title: 'Embedded Chat',
        }),
      }
    );

    const text = await dustRes.text();
    console.log('Dust conversation response:', dustRes.status, text);

    if (!dustRes.ok) {
      return NextResponse.json(
        { error: `Dust API error ${dustRes.status}: ${text}` },
        { status: dustRes.status }
      );
    }

    const data = JSON.parse(text);
    return NextResponse.json({ conversationId: data.conversation.sId });
  } catch (err) {
    console.error('conversation route error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
