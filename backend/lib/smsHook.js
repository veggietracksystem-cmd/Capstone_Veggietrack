const { Webhook } = require('standardwebhooks');
const { normalizePhone, isValidPhone } = require('../../mobile/src/lib/phone');
function createSmsHook({ env = process.env, fetchImpl = global.fetch, report = () => {} } = {}) {
  return async (req, res) => {
    const fail = (status, message) => res.status(status).json({ error: { http_code: status, message } });
    const isProduction = String(env.NODE_ENV || '').toLowerCase() === 'production';
    const deliveryEnabled = env.PHILSMS_DELIVERY_ENABLED === 'true';
    if (!env.SEND_SMS_HOOK_SECRET || !env.PHILSMS_API_TOKEN || !env.PHILSMS_SENDER_ID) {
      report('configuration_missing');
      if (!isProduction) return res.status(200).json({ ok: true, mode: 'development-skip', message: 'PhilSMS is disabled in development mode.' });
      return fail(503, 'SMS delivery is not configured.');
    }
    if (!deliveryEnabled) {
      report('delivery_disabled');
      if (!isProduction) return res.status(200).json({ ok: true, mode: 'development-skip', message: 'PhilSMS is disabled in development mode.' });
      return fail(503, 'SMS delivery is not configured.');
    }
    let payload;
    try {
      payload = new Webhook(env.SEND_SMS_HOOK_SECRET.replace(/^v1,whsec_/, '')).verify(req.body.toString('utf8'), req.headers);
    } catch { return fail(401, 'Invalid hook signature.'); }
    // Supabase's current SMS payload supplies the actual destination in sms.phone.
    // Legacy registration payloads use user.phone. A pending new_phone without
    // sms.phone is ambiguous (e.g. recovery during a pending change): fail closed.
    if (!payload?.sms?.phone && payload?.user?.new_phone) return fail(400, 'SMS destination is unavailable.');
    const phone = normalizePhone(payload?.sms?.phone || payload?.user?.phone);
    const otp = payload?.sms?.otp;
    if (!payload?.user?.id || !isValidPhone(phone) || typeof otp !== 'string' || !/^\d{6,10}$/.test(otp))
      return fail(400, 'Invalid SMS hook payload.');
    try {
      const response = await fetchImpl('https://app.philsms.com/api/v3/sms/send', {
        method: 'POST', headers: { Authorization: `Bearer ${env.PHILSMS_API_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ recipient: phone.slice(1), sender_id: env.PHILSMS_SENDER_ID, type: 'plain', message: `Your VeggieTrack verification code is ${otp}. Do not share this code.` }),
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) {
        report(`provider_http_${response.status}`);
        return fail(502, 'SMS delivery failed. Please try again later.');
      }
      const result = await response.json();
      if (result?.status !== 'success') {
        report('provider_rejected');
        return fail(502, 'SMS delivery failed. Please try again later.');
      }
      report('sent');
      return res.status(200).json({});
    } catch {
      report('provider_network_failure');
      return fail(502, 'SMS delivery failed. Please try again later.');
    }
  };
}
module.exports = { createSmsHook };
