import { PageStub } from '../components/PageStub';

export function Player() {
  return (
    <PageStub
      title="Practice / Test Player"
      path="/practice/:sessionId/q/:n"
      mockupNote="Validated as a real working HTML mockup already (blueprep_player_mock.html) — dual timers, pause overlay, popup time's-up modal, real text-selection highlighter, Desmos link-out, reference sheet, question navigator, module-submission gate. Not yet ported into a React component."
    />
  );
}
