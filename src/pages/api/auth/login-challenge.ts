import type { APIRoute } from 'astro';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { storeChallenge } from '../../../lib/db';

const RP_ID = process.env.RP_ID ?? 'thunderborn.dev';

export const GET: APIRoute = async () => {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'required',
  });
  const challengeToken = storeChallenge(options.challenge);
  return new Response(JSON.stringify({ challengeToken, options }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
