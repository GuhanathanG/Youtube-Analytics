import { LoginForm } from "./LoginForm";
import { Logo } from "@/components/Logo";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex justify-center"><Logo size={36} /></div>
        <div className="panel relative overflow-hidden p-7">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px overflow-hidden">
            <div className="h-px w-1/2 bg-gradient-to-r from-transparent via-accent to-transparent animate-[scan_3.2s_linear_infinite]" />
          </div>
          <div className="label">Restricted</div>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">Audience intelligence</h1>
          <p className="mt-1.5 text-[14px] text-ink-3">Every comment, every language, read by AI. Enter your password to continue.</p>
          <LoginForm next={next ?? "/"} />
        </div>
      </div>
    </main>
  );
}
