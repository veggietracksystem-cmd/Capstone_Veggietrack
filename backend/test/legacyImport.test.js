const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {importLegacy}=require('../scripts/import_legacy_auth');
const sql=fs.readFileSync(path.join(__dirname,'../sql/auth_supabase_migration.sql'),'utf8');
const ids=[...new Set([...sql.matchAll(/'([0-9a-f-]{36})'/g)].map(x=>x[1]))];
test('legacy dry run never fetches hashes or creates accounts; apply preserves all IDs; retry is idempotent',async()=>{
 const users=ids.map((id,i)=>({id,role:i===0?'distributor':'retailer',phone:'0917'+String(i).padStart(7,'0'),account_status:'active',legacy_access:true,auth_user_id:null}));
 let created=0,hashReads=0;
 const db={from(){let field,id;return {select(v){field=v;return this;},eq(k,v){if(k==='id')id=v;return this;},order:async()=>({data:users}),single:async()=>{if(field==='password_hash'){hashReads++;return {data:{password_hash:'$2b$10$'+'a'.repeat(53)}};}return {data:users.find(u=>u.id===id)};}};},auth:{admin:{
  createUser:async input=>{created++;assert.equal(input.phone_confirm,true);assert.ok(input.password_hash);const u=users.find(u=>u.id===input.id);assert.ok(u);u.auth_user_id=input.id;return {data:{user:{id:input.id}}};},
  getUserById:async id=>({data:{user:{id,phone:users.find(u=>u.id===id).phone,phone_confirmed_at:'2026-09-15'}}}),
 }}};
 await importLegacy(db);assert.equal(hashReads,0);assert.equal(created,0);
 await importLegacy(db,true);assert.equal(hashReads,12);assert.equal(created,12);
 await importLegacy(db,true);assert.equal(created,12);
});
