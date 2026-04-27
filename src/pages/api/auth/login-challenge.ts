import type { APIRoute } from 'astro';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { listPasskeys, storeChallenge } from '../../../lib/db';

const RP_ID = process.env.RP_ID ?? 'thunderborn.dev';

export const GET: APIRoute = async () => {
  const passkeys = listPasskeys();
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'required',
    allowCredentials: passkeys.map(p => ({
      id: p.credential_id.toString('base64url'),
      type: 'public-key' as const,
    })),
  });
  const challengeToken = storeChallenge(options.challenge);
  return new Response(JSON.stringify({ challengeToken, options }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
