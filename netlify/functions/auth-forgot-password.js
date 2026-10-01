// Starts an admin password-recovery flow: emails a one-time 6-digit code to
// the configured recovery address (settings key 'adminEmail'). No session
// required — this IS the "I lost access" path — so the response is kept
// generic and rate-limited rather than leaking configuration details.
const { connectLambda, getSettingRaw, setSettingRaw, sha256Hex, randSalt, genCode, sendEmail, json } = require('./_lib');

const COOLDOWN_MS = 60 * 1000; // don't re-send within a minute of the last request
const CODE_TTL_MS = 15 * 60 * 1000;

exports.handler = async (event) => {
  connectLambda(event);
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const adminEmail = await getSettingRaw('adminEmail');
  if (!adminEmail) return json(200, { ok: true, sent: false, reason: 'No recovery email is configured yet.' });

  const existing = await getSettingRaw('resetCode');
  if (existing && existing.requestedAt && (Date.now() - existing.requestedAt) < COOLDOWN_MS) {
    // A code was just sent; don't mint/send another, but don't error either.
    return json(200, { ok: true, sent: true });
  }

  const code = genCode();
  const salt = randSalt();
  const hash = sha256Hex(salt + '|' + code);
  await setSettingRaw('resetCode', { salt: salt, hash: hash, expires: Date.now() + CODE_TTL_MS, attempts: 0, requestedAt: Date.now() });

  try {
    await sendEmail(
      adminEmail,
      'Character Codex — admin password reset code',
      '<p>Someone requested a password reset for the Character Codex admin account.</p>' +
      '<h2 style="letter-spacing:4px;font-family:monospace">' + code + '</h2>' +
      '<p>This code expires in 15 minutes. If you didn’t request this, you can safely ignore this email.</p>'
    );
  } catch (e) {
    return json(200, { ok: true, sent: false, reason: 'Could not send the email — check the RESEND_API_KEY is set.' });
  }

  return json(200, { ok: true, sent: true });
};
