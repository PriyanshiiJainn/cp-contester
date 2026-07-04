import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@cp/db";
import { createCfClient, CfApiError } from "@cp/cf";
import { hashPassword, setSessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  handle: z
    .string()
    .min(1)
    .max(24)
    .regex(/^[A-Za-z0-9_.-]+$/, "invalid Codeforces handle"),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }

  const email = body.email.trim().toLowerCase();
  const handle = body.handle.trim();

  const cf = createCfClient("https://codeforces.com/api");
  let canonicalHandle: string;
  try {
    const info = await cf.getUserInfo(handle);
    canonicalHandle = info.handle;
  } catch (e) {
    const message =
      e instanceof CfApiError
        ? `Codeforces handle not found: ${handle}`
        : "Could not verify Codeforces handle";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const prisma = getPrisma();
  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { email },
        { handle: { equals: canonicalHandle, mode: "insensitive" } },
      ],
    },
    select: { email: true, handle: true },
  });
  if (existing) {
    if (existing.email === email) {
      return NextResponse.json({ error: "email already registered" }, { status: 409 });
    }
    return NextResponse.json(
      { error: "Codeforces handle already linked to an account" },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(body.password);
  try {
    const user = await prisma.user.create({
      data: { email, passwordHash, handle: canonicalHandle },
      select: { id: true, email: true, handle: true },
    });
    await setSessionCookie(user);
    return NextResponse.json({ user });
  } catch (e) {
    const message = e instanceof Error ? e.message : "signup failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
