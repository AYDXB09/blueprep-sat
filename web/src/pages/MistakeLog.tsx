import { PageStub } from '../components/PageStub';

export function MistakeLog() {
  return (
    <PageStub
      title="Mistake Log"
      path="/mistakes"
      mockupNote="Persistent across sessions — a question leaves this list only once answered correctly (spaced resurfacing, user_settings.mistake_resurface_days). This is also where the AI Performance Coach feature belongs, per the existing app's pattern."
    />
  );
}
