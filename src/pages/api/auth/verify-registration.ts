import type { APIRoute } from 'astro';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import {
  consumeChallenge, isSetupTokenValid, consumeSetupToken,
  createPasskey, createSession, validateSession,
} from '../../../lib/db';

const RP_ID = process.env.RP_ID ?? 'thunderborn.dev';
const ORIGIN = process.env.ORIGIN ?? 'https://thunderborn.dev';

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: { challengeToken: string; setupToken?: string; name: string; response: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const sessionId = cookies.get('session')?.value;
  const isAdmin = sessionId ? validateSession(sessionId) : false;
  const isSetup = body.setupToken ? isSetupTokenValid(body.setupToken) : false;
  if (!isAdmin && !isSetup) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  const challenge = consumeChallenge(body.challengeToken);
  if (!challenge) {
    return new Response(JSON.stringify({ error: 'Challenge expired or invalid' }), { status: 400 });
  }

  const regResponse = body.response as Parameters<typeof verifyRegistrationResponse>[0]['response'];
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: regResponse,
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Verification failed' }), { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return new Response(JSON.stringify({ error: 'Not verified' }), { status: 401 });
  }

  const { credential } = verification.registrationInfo;
  createPasskey({
    credential_id: credential.id,
    public_key: credential.publicKey,
    counter: credential.counter,
    name: body.name || 'Passkey',
  });

  if (body.setupToken) {
    consumeSetupToken(body.setupToken);
    const sessionId = createSession();
    cookies.set('session', sessionId, {
      httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 7 * 24 * 60 * 60,
    });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
