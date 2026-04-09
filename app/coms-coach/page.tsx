import DustChat from '@/components/DustChat';

export default function ComsCoach() {
  return (
    <DustChat
      agentId={process.env.DUST_COMS_COACH_AGENT_ID}
      title="COMS Coach"
      subtitle="Your communications coaching assistant"
      headerImage="/COMS-Coach.png"
      headerImageAlt="COMS Coach"
      compact
    />
  );
}
