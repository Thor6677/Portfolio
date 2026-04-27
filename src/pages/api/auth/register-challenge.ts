import type { APIRoute } from 'astro';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { isSetupTokenValid, listPasskeys, storeChallenge, validateSession } from '../../../lib/db';

const RP_ID = process.env.RP_ID ?? 'thunderborn.dev';
const RP_NAME = process.env.RP_NAME ?? 'thunderborn.dev';

export const GET: APIRoute = async ({ url, cookies }) => {
  // Allow if authenticated admin OR valid setup token
  const sessionId = cookies.get('session')?.value;
  const isAdmin = sessionId ? validateSession(sessionId) : false;
  const setupToken = url.searchParams.get('token') ?? '';
  const isSetup = isSetupTokenValid(setupToken);

  if (!isAdmin && !isSetup) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  const existingPasskeys = listPasskeys();
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: 'admin',
    userDisplayName: 'Admin',
    attestationType: 'none',
    excludeCredentials: existingPasskeys.map(p => ({
      id: new Uint8Array(p.credential_id),
      type: 'public-key' as const,
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
  });
  const challengeToken = storeChallenge(options.challenge);
  return new Response(JSON.stringify({ challengeToken, options, setupToken }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
