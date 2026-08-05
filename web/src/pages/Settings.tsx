import { PageStub } from '../components/PageStub';

export function Settings() {
  return (
    <PageStub
      title="Settings"
      path="/settings"
      mockupNote="Maps directly onto user_settings columns — timer_mode_default, include_retired_default, show_ai_cues_default, explanation_verbosity, mistake_resurface_days, font_size, theme, target_score, test_date, weekly_email_digest."
    />
  );
}
