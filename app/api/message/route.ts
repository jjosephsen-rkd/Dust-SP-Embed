import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const { conversationId, message } = await request.json();

  const response = await fetch(
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
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          fullName: 'Web User',
          origin: 'api',
        },
      }),
    }
  );

  return NextResponse.json({ success: response.ok });
}
