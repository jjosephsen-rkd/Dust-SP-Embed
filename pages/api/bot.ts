/**
 * Teams Bot endpoint — implements the Bot Framework protocol directly
 * without the botbuilder SDK. Processes the Dust response synchronously
 * and returns the reply inline in the HTTP 200 response body, which is
 * required on Vercel (functions terminate as soon as res.end() is called).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getDustClient } from '@/lib/dustClient';
import { getTeamsConversationId, setTeamsConversationId } from '@/lib/teamsConversations';

export const config = { api: { bodyParser: true } };
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Helpers
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
// Core processing — runs after we've already returned 200 to Bot Framework
// ---------------------------------------------------------------------------

async function processActivity(activity: Record<string, unknown>): Promise<string> {
  const teamsConvId = (activity.conversation as Record<string, string>)?.id;
  const userText = stripMentions((activity.text as string) ?? '');

  if (!userText || !teamsConvId) return '';

  const agentId = process.env.DUST_COMS_COACH_AGENT_ID ?? process.env.DUST_AGENT_ID!;
  const dust = getDustClient();
  const fromName = (activity.from as Record<string, string> | undefined)?.name;

  const userCtx = {
    username: fromName?.replace(/\s+/g, '_').toLowerCase() ?? 'teams_user',
    timezone: 'UTC',
    fullName: fromName ?? 'Teams User',
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
  return stripCitations(response);
}

// ---------------------------------------------------------------------------
// Next.js handler
// ---------------------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  // Handle CORS preflight (Bot Framework Test in Web Chat sends OPTIONS)
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

  // Ack non-message activities silently
  if (activity.type !== 'message') {
    res.status(200).end();
    return;
  }

  // Process Dust synchronously and return the reply inline in the HTTP response.
  // This is required on Vercel — functions terminate as soon as res.end() is called,
  // so async work after returning 200 never completes.
  // Bot Framework supports receiving the reply activity directly in the 200 response body.
  try {
    const responseText = await processActivity(activity);
    res.status(200).json({ type: 'message', text: responseText });
  } catch (err) {
    console.error('[Teams Bot] Error processing activity:', err);
    res.status(200).json({ type: 'message', text: 'Sorry, something went wrong. Please try again.' });
  }
}
