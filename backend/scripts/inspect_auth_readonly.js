// Read-only inspection: GET requests only. Never prints credentials or raw Auth records.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const config = dotenv.parse(fs.readFileSync(path.join(__dirname, '../.env')));
const base = config.SUPABASE_URL?.replace(/\/$/, '');
const key = config.SUPABASE_SERVICE_KEY;
const normalize = value => {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^09\d{9}$/.test(digits)) return `63${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `63${digits}`;
  return digits;
};
const mask = value => value ? `***${String(value).slice(-4)}` : null;
async function get(route) {
  try {
    const response = await fetch(`${base}${route}`, {
      method: 'GET', headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw Object.assign(new Error('HTTP failure'), { safeCode: `HTTP_${response.status}` });
    return await response.json();
  } catch (error) {
    throw Object.assign(new Error('Read-only request failed'), {
      safeCode: error.safeCode || error.cause?.code || error.name,
    });
  }
}
async function main() {
  if (!base || !key) throw Object.assign(new Error('Missing configuration'), { safeCode: 'MISSING_CONFIG' });
  const schema = await get('/rest/v1/');
  const columns = schema.definitions?.users?.properties || {};
  console.log(JSON.stringify({ section: 'users_columns', columns: Object.entries(columns).map(([name, v]) => ({ name, type: v.type, format: v.format })) }));
  const safeFields = ['id', 'role', 'phone', 'created_at', 'auth_user_id', 'supabase_user_id', 'status', 'account_status', 'phone_verified_at', 'approved_at', 'approved_by', 'disabled_at'];
  const fields = safeFields.filter(name => name in columns);
  if (!fields.includes('id') || !fields.includes('role')) throw Object.assign(new Error('Schema unavailable'), { safeCode: 'USER_SCHEMA_UNAVAILABLE' });
  const users = [];
  for (let offset = 0; ; offset += 500) {
    const page = await get(`/rest/v1/users?select=${fields.join(',')}&order=id&limit=500&offset=${offset}`);
    users.push(...page);
    if (!page.length) break;
  }
  const roles = {};
  for (const user of users) roles[user.role] = (roles[user.role] || 0) + 1;
  console.log(JSON.stringify({ section: 'public_users', count: users.length, roles,
    distributors: users.filter(u => u.role === 'distributor').map(({ phone, ...u }) => ({ ...u, phone_masked: mask(phone) })),
    invalidPhPhones: users.filter(u => !/^639\d{9}$/.test(normalize(u.phone))).map(u => u.id),
    duplicateNormalizedPhones: users.filter(u => u.phone && users.filter(v => normalize(v.phone) === normalize(u.phone)).length > 1).map(u => u.id),
  }));
  const authUsers = [];
  for (let page = 1; ; page++) {
    const result = await get(`/auth/v1/admin/users?page=${page}&per_page=100`);
    authUsers.push(...result.users);
    if (!result.users.length) break;
  }
  console.log(JSON.stringify({ section: 'auth_linkage', authUserCount: authUsers.length,
    authPhoneConfirmedCount: authUsers.filter(a => a.phone_confirmed_at).length,
    profiles: users.map(u => ({ id: u.id, role: u.role, phone_masked: mask(u.phone),
      status: u.account_status ?? u.status ?? null,
      candidates: authUsers.filter(a => a.id === u.id || a.id === u.auth_user_id || a.id === u.supabase_user_id || (u.phone && normalize(a.phone) === normalize(u.phone))).map(a => ({
        auth_id: a.id, same_id: a.id === u.id, explicit_link: a.id === u.auth_user_id || a.id === u.supabase_user_id,
        same_phone: !!a.phone && normalize(a.phone) === normalize(u.phone), phone_confirmed_at: a.phone_confirmed_at || null,
        providers: (a.identities || []).map(i => i.provider),
      })),
    })),
  }));
  console.log('RLS policies, triggers, foreign keys and migration history require SQL catalog inspection; REST is insufficient. Phone matches are candidates, not proof of identity.');
}
main().catch(error => { console.error(JSON.stringify({ inspection_error: error.safeCode || 'INSPECTION_FAILED' })); process.exitCode = 1; });
