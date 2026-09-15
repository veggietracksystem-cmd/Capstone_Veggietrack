const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const sql = fs.readFileSync(path.join(__dirname, '../sql/user_avatars.sql'), 'utf8');

test('avatar migration preserves legacy accounts, stamps changes and preserves RLS lockdown', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE public.users(id uuid PRIMARY KEY, full_name text, role text);
      CREATE FUNCTION public.vt_account_context(uuid,uuid) RETURNS jsonb LANGUAGE sql AS 'SELECT to_jsonb(u) FROM public.users u WHERE id=$1';
      ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
      CREATE POLICY vt_api_only ON public.users AS RESTRICTIVE FOR ALL TO anon, authenticated USING(false) WITH CHECK(false);
      GRANT ALL ON public.users TO service_role;
      INSERT INTO public.users VALUES('11111111-1111-1111-1111-111111111111','Legacy','farmer');`);
    await db.exec(sql);
    const row = async () => (await db.query('SELECT * FROM public.users')).rows[0];
    assert.equal((await row()).avatar_url, null);
    assert.equal((await row()).profile_picture_updated_at, null);
    await db.exec("UPDATE public.users SET profile_picture_updated_at='2000-01-01'");
    assert.equal((await row()).profile_picture_updated_at, null);
    const photo = 'https://res.cloudinary.com/veggietrack/image/upload/v123/avatar.jpg';
    await db.query("UPDATE public.users SET avatar_url=$1,profile_picture_updated_at='2000-01-01'", [photo]);
    const stamp = (await row()).profile_picture_updated_at;
    assert.ok(new Date(stamp).getUTCFullYear() > 2000);
    await db.exec("UPDATE public.users SET full_name='Renamed',profile_picture_updated_at='2001-01-01'");
    assert.deepEqual((await row()).profile_picture_updated_at, stamp);
    const context = await db.query("SELECT vt_account_context('11111111-1111-1111-1111-111111111111',NULL) AS u");
    assert.equal(context.rows[0].u.avatar_url, photo);
    for (const url of ['', 'https://evil.test/p.jpg', photo.replace('avatar.jpg','../avatar.jpg')]) {
      await assert.rejects(db.query('UPDATE public.users SET avatar_url=$1', [url]), /users_avatar_url_format/);
    }
    await db.query('UPDATE public.users SET avatar_url=$1', [photo.replace('v123','v124')]);
    assert.ok(new Date((await row()).profile_picture_updated_at) >= new Date(stamp));
    for (const role of ['anon','authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(db.query('SELECT avatar_url FROM public.users'), /permission denied/);
      await assert.rejects(db.query('UPDATE public.users SET avatar_url=NULL'), /permission denied/);
      await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role');
    assert.equal((await row()).full_name, 'Renamed');
    await db.exec('RESET ROLE');
    assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.users'::regclass")).rows[0].relrowsecurity, true);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE tablename='users' AND policyname='vt_api_only'")).rows[0].n, 1);
  } finally { await db.close(); }
});
