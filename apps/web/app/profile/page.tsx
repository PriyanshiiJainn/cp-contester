import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth";
import { ProfileApp } from "./profile-app";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await getSessionUser().catch(() => null);

  return (
    <Suspense
      fallback={
        <div className="cf-box">
          <div className="cf-bar">Profile</div>
          <p className="cf-muted p-4">Loading…</p>
        </div>
      }
    >
      <ProfileApp
        sessionHandle={session?.handle ?? null}
        sessionEmail={session?.email ?? null}
      />
    </Suspense>
  );
}
