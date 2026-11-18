import { LoginForm } from "./LoginForm";
import { safeNext } from "@/lib/safe-next";
import { Wordmark } from "@/components/Shell";

export const metadata = { title: "Sign in" };

/** Signal sign-in: one pulsing dot and a single hairline password field. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="safe-top relative flex min-h-dvh flex-col px-5 sm:px-10">
      <header className="flex h-16 items-center justify-between">
        <Wordmark />
        <span className="label hidden sm:inline">Restricted access</span>
      </header>
      <div className="flex flex-1 items-center justify-center py-10">
        <LoginForm next={safeNext(next)} />
      </div>
      <footer className="label flex flex-wrap justify-between gap-2 pb-6" style={{ paddingBottom: "calc(24px + env(safe-area-inset-bottom))" }}>
        <span>Audience intelligence</span><span>Every comment · every language</span>
      </footer>
    </main>
  );
}
