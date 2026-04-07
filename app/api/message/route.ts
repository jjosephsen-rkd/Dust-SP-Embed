import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { conversationId, message } = await request.json();

    const dustRes = await fetch(
      `${process.env.DUST_API_BASE_URL}/w/${process.env.DUST_WORKSPACE_ID}/assistant/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.DUST_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
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
        }),
      }
    );

    const text = await dustRes.text();
    console.log('Dust post message:', dustRes.status, text.slice(0, 500));

    if (!dustRes.ok) {
      return NextResponse.json(
        { error: `Dust API error ${dustRes.status}: ${text}` },
        { status: dustRes.status }
      );
    }

    const data = JSON.parse(text);
    // Returns the user message; the agent message sId comes via the events stream
    return NextResponse.json({ messageId: data.message.sId });
  } catch (err) {
    console.error('message route error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
