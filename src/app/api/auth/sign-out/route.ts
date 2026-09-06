import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/auth/server';
import { recordAudit } from '@/data/repositories/audit';
import { SESSION_COOKIE } from '@/auth/session';

/** Ends the session and returns to the sign-in screen. */
export async function POST(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (user) {
    await recordAudit({ action: 'auth.sign_out', actorId: user.id, actorEmail: user.email });
  }
  const response = NextResponse.redirect(new URL('/sign-in', request.url), { status: 303 });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
