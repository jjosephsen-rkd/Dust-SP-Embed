/**
 * In-memory map from Teams conversation ID → Dust conversation ID.
 *
 * This keeps each Teams chat thread wired to the same Dust conversation so
 * multi-turn context is preserved. A server restart clears the map and
 * each thread will automatically start a fresh Dust conversation on the
 * next message.
 *
 * For multi-instance deployments, swap this out for Redis or a database.
 */
const conversationMap = new Map<string, string>();

export function getTeamsConversationId(teamsConvId: string): string | undefined {
  return conversationMap.get(teamsConvId);
}

export function setTeamsConversationId(teamsConvId: string, dustConvId: string): void {
  conversationMap.set(teamsConvId, dustConvId);
}
