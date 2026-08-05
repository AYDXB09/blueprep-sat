import { PageStub } from '../components/PageStub';

export function Login() {
  return (
    <PageStub
      title="Login / Sign Up"
      path="/login"
      mockupNote="Supabase Auth handles identity directly — email/password or OAuth. First successful sign-in creates the thin public.users row keyed to auth.users.id."
    />
  );
}
