import { PageStub } from '../components/PageStub';

export function SessionSummary() {
  return (
    <PageStub
      title="Session Summary"
      path="/sessions/:sessionId"
      mockupNote="Reads the frozen score_summary jsonb plus a join across question_attempts for that session_id. Every missed question should link into the trap/cue review card and auto-feed the Mistake Log."
    />
  );
}
