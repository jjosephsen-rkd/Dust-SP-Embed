export interface Message {
  id: string;
  type: 'user' | 'agent';
  content: string;
  timestamp: number;
}

export interface DustMessage {
  content: string;
  mentions: Array<{ configurationId: string }>;
  context: {
    username: string;
    timezone: string;
    fullName: string;
    origin: string;
  };
}
