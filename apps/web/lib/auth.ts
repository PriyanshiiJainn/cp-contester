import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { getPrisma } from "@cp/db";

export const SESSION_COOKIE = "cp_session";
const SESSION_DAYS = 30;

export type SessionUser = {
  id: string;
  email: string;
  handle: string;
};

function sessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET must be set (at least 16 characters)");
  }
  return new TextEncoder().encode(secret);
}

function hasSessionSecret(): boolean {
  const secret = process.env.SESSION_SECRET;
  return Boolean(secret && secret.length >= 16);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email, handle: user.handle })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(sessionSecret());
}

export async function readSessionToken(
  token: string,
): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, sessionSecret());
    const id = payload.sub;
    const email = payload.email;
    const handle = payload.handle;
    if (
      typeof id !== "string" ||
      typeof email !== "string" ||
      typeof handle !== "string"
    ) {
      return null;
    }
    return { id, email, handle };
  } catch {
    return null;
  }
}

export async function setSessionCookie(user: SessionUser): Promise<void> {
  const token = await createSessionToken(user);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  if (!hasSessionSecret()) return null;
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await readSessionToken(token);
  if (!session) return null;

  // Ensure the account still exists (e.g. after a DB wipe).
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, email: true, handle: true },
  });
  return user;
}
