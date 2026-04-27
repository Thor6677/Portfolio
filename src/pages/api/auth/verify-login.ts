import type { APIRoute } from 'astro';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import {
  consumeChallenge, getPasskeyByCredentialId,
  updatePasskeyCounter, createSession,
} from '../../../lib/db';

const RP_ID = process.env.RP_ID ?? 'thunderborn.dev';
const ORIGIN = process.env.ORIGIN ?? 'https://thunderborn.dev';

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: { challengeToken: string; response: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const challenge = consumeChallenge(body.challengeToken);
  if (!challenge) {
    return new Response(JSON.stringify({ error: 'Challenge expired or invalid' }), { status: 400 });
  }

  const authResponse = body.response as Parameters<typeof verifyAuthenticationResponse>[0]['response'];
  const passkey = getPasskeyByCredentialId(authResponse.rawId);
  if (!passkey) {
    return new Response(JSON.stringify({ error: 'Passkey not found' }), { status: 400 });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: authResponse,
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: passkey.credential_id.toString(),
        publicKey: new Uint8Array(passkey.public_key),
        counter: passkey.counter,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Verification failed' }), { status: 400 });
  }

  if (!verification.verified) {
    return new Response(JSON.stringify({ error: 'Not verified' }), { status: 401 });
  }

  updatePasskeyCounter(passkey.id, verification.authenticationInfo.newCounter);
  const sessionId = createSession();
  cookies.set('session', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
