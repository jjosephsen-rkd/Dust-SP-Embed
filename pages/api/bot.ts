/**
 * Teams Bot Framework endpoint.
 *
 * This route lives in the Pages Router so that botbuilder's CloudAdapter
 * gets a real Node.js IncomingMessage / ServerResponse pair. The App Router
 * uses the Web Streams API which is incompatible with botbuilder's process().
 *
 * Body parsing is disabled so botbuilder can read the raw request stream itself.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  TurnContext,
  ActivityTypes,
} from 'botbuilder';
import { getDustClient } from '@/lib/dustClient';
import { getTeamsConversationId, setTeamsConversationId } from '@/lib/teamsConversations';

export const config = {
  api: { bodyParser: false },
};

// ---------------------------------------------------------------------------
// Adapter — initialised once per worker process
// ---------------------------------------------------------------------------

const auth = new ConfigurationBotFrameworkAuthentication({
  MicrosoftAppId: process.env.MICROSOFT_APP_ID ?? '',
  MicrosoftAppPassword: process.env.MICROSOFT_APP_PASSWORD ?? '',
  // Change to 'SingleTenant' and add MicrosoftAppTenantId for tenant-locked bots
  MicrosoftAppType: 'MultiTenant',
});

const adapter = new CloudAdapter(auth);

adapter.onTurnError = async (context: TurnContext, error: Error) => {
  console.error('[Teams Bot] Unhandled turn error:', error);
  try {
    await context.sendActivity('Something went wrong on my end. Please try again.');
  } catch {
    // Swallow send errors to avoid infinite loops
  }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Remove Teams @-mention tags before sending text to Dust. */
function stripMentions(text: string): string {
  return text.replace(/<at>[^<]*<\/at>/gi, '').trim();
}

/** Remove Dust citation tags like :cite[abc] from responses. */
function stripCitations(text: string): string {
  return text.replace(/:cite\[[^\]]*\]/g, '');
}

/**
 * Stream a Dust agent response and return the completed text.
 * Waits for agent_message_success (or falls back to accumulated tokens).
 */
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
    const type = (event as Record<string, unknown>).type as string;

    if (type === 'generation_tokens') {
      const e = event as Record<string, unknown>;
      if (e.classification === 'tokens' && e.text) {
        content += e.text as string;
      }
    } else if (type === 'agent_message_success') {
      const msg = (event as Record<string, unknown>).message as Record<string, unknown> | undefined;
      content = (msg?.content as string | null) ?? content;
      break;
    } else if (type === 'agent_error' || type === 'user_message_error') {
      const err = (event as Record<string, unknown>).error as Record<string, unknown> | undefined;
      throw new Error((err?.message as string) ?? 'Agent returned an error');
    }
  }

  return content;
}

// ---------------------------------------------------------------------------
// Turn handler
// ---------------------------------------------------------------------------

async function handleTurn(context: TurnContext): Promise<void> {
  if (context.activity.type !== ActivityTypes.Message) return;

  const teamsConvId = context.activity.conversation.id;
  const userText = stripMentions(context.activity.text ?? '');
  if (!userText) return;

  const agentId = process.env.DUST_COMS_COACH_AGENT_ID ?? process.env.DUST_AGENT_ID!;

  // Let Teams know we're working on it
  await context.sendActivity({ type: 'typing' });

  const dust = getDustClient();
  let dustConvId = getTeamsConversationId(teamsConvId);
  let userMessageId: string;

  const userCtx = {
    username:
      context.activity.from.name?.replace(/\s+/g, '_').toLowerCase() ?? 'teams_user',
    timezone: 'UTC',
    fullName: context.activity.from.name ?? 'Teams User',
    email: null as null,
    profilePictureUrl: null as null,
    origin: 'api' as const,
  };

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
  await context.sendActivity(stripCitations(response));
}

// ---------------------------------------------------------------------------
// Next.js API handler
// ---------------------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await adapter.process(req as any, res as any, handleTurn);
}
