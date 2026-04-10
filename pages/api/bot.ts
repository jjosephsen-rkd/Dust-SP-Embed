/**
 * Teams Bot endpoint — implements the Bot Framework protocol directly
 * without the botbuilder SDK.
 *
 * Flow:
 *  1. Receive Activity POST from Bot Framework
 *  2. Await Dust response (synchronously, before responding)
 *  3. POST the reply to the Bot Connector REST API
 *  4. Return 200 to Bot Framework
 *
 * This order is required on Vercel: the function must complete all work
 * before returning a response — anything after res.end() is killed.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getDustClient } from '@/lib/dustClient';
import { getTeamsConversationId, setTeamsConversationId } from '@/lib/teamsConversations';

export const config = { api: { bodyParser: true } };
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Bot Connector helpers
// ---------------------------------------------------------------------------

async function getBotToken(): Promise<string> {
  const res = await fetch(
    'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.MICROSOFT_APP_ID!,
        client_secret: process.env.MICROSOFT_APP_PASSWORD!,
        scope: 'https://api.botframework.com/.default',
      }).toString(),
    }
  );
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error('Failed to obtain bot access token');
  return data.access_token;
}

async function sendReply(
  serviceUrl: string,
  conversationId: string,
  activityId: string,
  text: string,
  token: string
): Promise<void> {
  const base = serviceUrl.endsWith('/') ? serviceUrl : `${serviceUrl}/`;
  const url = `${base}v3/conversations/${encodeURIComponent(conversationId)}/activities/${encodeURIComponent(activityId)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ type: 'message', text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bot Connector reply failed (${res.status}): ${body}`);
  }
}

// ---------------------------------------------------------------------------
// Dust helpers
// ---------------------------------------------------------------------------

function stripMentions(text: string): string {
  return text.replace(/<at>[^<]*<\/at>/gi, '').trim();
}

function stripCitations(text: string): string {
  return text.replace(/:cite\[[^\]]*\]/g, '');
}

async function getFullDustResponse(conversationId: string, userMessageId: string): Promise<string> {
  const dust = getDustClient();

  const convResult = await dust.getConversation({ conversationId });
  if (convResult.isErr()) throw new Error(convResult.error.message);

  const streamResult = await dust.streamAgentAnswerEvents({
    conversation: convResult.value,
    userMessageId,
  });
  if (streamResult.isErr()) throw new Error(streamResult.error.message);

  const { eventStream } = streamResult.value;
  let content = '';

  for await (const event of eventStream) {
    const e = event as Record<string, unknown>;
    const type = e.type as string;

    if (type === 'generation_tokens') {
      if (e.classification === 'tokens' && e.text) {
        content += e.text as string;
      }
    } else if (type === 'agent_message_success') {
      const msg = e.message as Record<string, unknown> | undefined;
      content = (msg?.content as string | null) ?? content;
      break;
    } else if (type === 'agent_error' || type === 'user_message_error') {
      const err = e.error as Record<string, unknown> | undefined;
      throw new Error((err?.message as string) ?? 'Agent returned an error');
    }
  }

  return content;
}

// ---------------------------------------------------------------------------
// Core processing
// ---------------------------------------------------------------------------

async function processActivity(activity: Record<string, unknown>): Promise<void> {
  const serviceUrl = activity.serviceUrl as string;
  const teamsConvId = (activity.conversation as Record<string, string>)?.id;
  const activityId = activity.id as string;
  const userText = stripMentions((activity.text as string) ?? '');

  if (!userText || !serviceUrl || !teamsConvId) return;

  const agentId = process.env.DUST_COMS_COACH_AGENT_ID ?? process.env.DUST_AGENT_ID!;
  const dust = getDustClient();
  const fromName = (activity.from as Record<string, string> | undefined)?.name;

  const userCtx = {
    username: (fromName?.replace(/\s+/g, '_').toLowerCase() || 'teams_user'),
    timezone: 'UTC',
    fullName: fromName || 'Teams User',
    email: null as null,
    profilePictureUrl: null as null,
    origin: 'api' as const,
  };

  let dustConvId = getTeamsConversationId(teamsConvId);
  let userMessageId: string;

  if (!dustConvId) {
    const result = await dust.createConversation({
      title: null,
      visibility: 'unlisted',
      message: {
        content: userText,
        mentions: [{ configurationId: agentId }],
        context: userCtx,
      },
      blocking: false,
    });
    if (result.isErr()) throw new Error(result.error.message);
    dustConvId = result.value.conversation.sId;
    userMessageId = result.value.message!.sId;
    setTeamsConversationId(teamsConvId, dustConvId);
  } else {
    const result = await dust.postUserMessage({
      conversationId: dustConvId,
      message: {
        content: userText,
        mentions: [{ configurationId: agentId }],
        context: userCtx,
      },
    });
    if (result.isErr()) throw new Error(result.error.message);
    userMessageId = result.value.sId;
  }

  const response = await getFullDustResponse(dustConvId, userMessageId);
  const token = await getBotToken();
  await sendReply(serviceUrl, teamsConvId, activityId, stripCitations(response), token);
}

// ---------------------------------------------------------------------------
// Next.js handler
// ---------------------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const activity = req.body as Record<string, unknown>;

  if (activity.type !== 'message') {
    res.status(200).end();
    return;
  }

  const serviceUrl = activity.serviceUrl as string;
  const teamsConvId = (activity.conversation as Record<string, string>)?.id;
  const activityId = activity.id as string;

  try {
    await processActivity(activity);
    res.status(200).end();
  } catch (err) {
    console.error('[Teams Bot] Error processing activity:', err);
    try {
      const token = await getBotToken();
      await sendReply(
        serviceUrl,
        teamsConvId,
        activityId,
        'Sorry, something went wrong. Please try again.',
        token
      );
    } catch (sendErr) {
      console.error('[Teams Bot] Failed to send error reply:', sendErr);
    }
    res.status(200).end();
  }
}
