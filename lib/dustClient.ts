import { DustAPI } from '@dust-tt/client';

export function getDustClient() {
  return new DustAPI(
    { url: 'https://dust.tt' },
    {
      workspaceId: process.env.DUST_WORKSPACE_ID!,
      apiKey: process.env.DUST_API_KEY!,
    },
    console
  );
}
