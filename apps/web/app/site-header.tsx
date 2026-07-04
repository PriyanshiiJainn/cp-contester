import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { LogoutButton } from "./logout-button";

export async function SiteHeader() {
  const user = await getSessionUser().catch(() => null);

  return (
    <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
      <div className="flex flex-wrap items-baseline gap-4">
        <Link href="/" className="text-xl font-bold no-underline hover:no-underline">
          CP <span className="text-[#0b5da8]">Contester</span>
        </Link>
        <span className="cf-muted text-xs">
          virtual contests · sample tests · submit on Codeforces
        </span>
      </div>
      <nav className="flex flex-wrap items-center gap-3 text-sm">
        <Link href="/">Contest</Link>
        <Link href="/profile">Profile</Link>
        {user ? (
          <>
            <Link href={`/profile?handle=${encodeURIComponent(user.handle)}`}>
              <b>{user.handle}</b>
            </Link>
            <LogoutButton />
          </>
        ) : (
          <>
            <Link href="/login">Log in</Link>
            <Link href="/signup">Sign up</Link>
          </>
        )}
      </nav>
    </header>
  );
}
