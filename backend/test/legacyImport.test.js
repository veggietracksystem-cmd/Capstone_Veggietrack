const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {importLegacy}=require('../scripts/import_legacy_auth');
const {TRUSTED_DISTRIBUTOR}=require('../lib/auth');
const sql=fs.readFileSync(path.join(__dirname,'../sql/auth_supabase_migration.sql'),'utf8');
const historicalIds=[...new Set([...sql.matchAll(/'([0-9a-f-]{36})'/g)].map(x=>x[1]))];
// The migration's seed distributor UUID is historical. Import behavior must
// use the currently authorized distributor identity instead.
const ids=[TRUSTED_DISTRIBUTOR,...historicalIds.slice(1)];
test('legacy dry run never fetches hashes or creates accounts; apply preserves all IDs; retry is idempotent',async()=>{
 const users=ids.map((id,i)=>({id,role:i===0?'distributor':'retailer',email:`legacy-${i}@example.com`,account_status:'active',legacy_access:true,auth_user_id:null}));
 let created=0,hashReads=0;
 const db={from(){let field,id;return {select(v){field=v;return this;},eq(k,v){if(k==='id')id=v;return this;},order:async()=>({data:users}),single:async()=>{if(field==='password_hash'){hashReads++;return {data:{password_hash:'$2b$10$'+'a'.repeat(53)}};}return {data:users.find(u=>u.id===id)};}};},auth:{admin:{
  createUser:async input=>{created++;assert.equal(input.email_confirm,true);assert.ok(input.password_hash);const u=users.find(u=>u.id===input.id);assert.ok(u);u.auth_user_id=input.id;return {data:{user:{id:input.id}}};},
  getUserById:async id=>({data:{user:{id,email:users.find(u=>u.id===id).email}}}),
  updateUserById:async(id,input)=>({data:{user:{id,email:input.email}}}),
 }}};
 await importLegacy(db);assert.equal(hashReads,0);assert.equal(created,0);
 await importLegacy(db,true);assert.equal(hashReads,12);assert.equal(created,12);
 await importLegacy(db,true);assert.equal(created,12);
});
