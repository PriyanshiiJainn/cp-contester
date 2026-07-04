import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@cp/db";
import { setSessionCookie, verifyPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }

  const email = body.email.trim().toLowerCase();
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, handle: true, passwordHash: true },
  });

  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    return NextResponse.json({ error: "invalid email or password" }, { status: 401 });
  }

  const session = { id: user.id, email: user.email, handle: user.handle };
  await setSessionCookie(session);
  return NextResponse.json({ user: session });
}
