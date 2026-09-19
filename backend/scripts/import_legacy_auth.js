// Dry-run by default. --apply is a manual deployment operation, never a test.
const { createClient } = require('@supabase/supabase-js');
const path = require('node:path');
const { TRUSTED_DISTRIBUTOR } = require('../lib/auth');
async function importLegacy(db, apply = false) {
  const { data: users, error } = await db.from('users').select('id,full_name,role,phone,email,legacy_access,auth_user_id,account_status').eq('legacy_access',true).order('id');
  if(error || users?.length !== 12 || users.filter(u=>u.role==='distributor').length!==1 || !users.some(u=>u.id===TRUSTED_DISTRIBUTOR && u.role==='distributor')) throw new Error('Reviewed legacy cohort does not match.');
  if(users.some(u=>u.account_status!=='active')) throw new Error('Legacy account-status preflight failed.');
  const emails=users.map(u=>String(u.email || '').trim().toLowerCase());
  if(emails.some(email=>!/^\S+@\S+\.\S+$/.test(email)) || new Set(emails).size!==emails.length) throw new Error('Every legacy user needs a unique email before Auth migration.');
  const results=[];
  for(const u of users) {
    const email=String(u.email).trim().toLowerCase();
    if(u.auth_user_id){
      const {data,error}=await db.auth.admin.getUserById(u.auth_user_id);
      if(error || data.user?.id!==u.id) throw new Error('Existing linkage needs review.');
      if(!apply){results.push({id:u.id,result:'would update existing Auth user to email; no deletion'});continue;}
      const updated=await db.auth.admin.updateUserById(u.auth_user_id,{email,email_confirm:true,phone:null});
      if(updated.error || updated.data.user?.id!==u.id || updated.data.user?.email!==email) throw new Error('Existing Auth email migration failed.');
      results.push({id:u.id,result:'updated existing Auth identity; same profile ID'});continue;
    }
    if(!apply){results.push({id:u.id,result:'would import same ID and password as email Auth; no SMS'});continue;}
    // Hash stays in memory between two trusted server APIs; never print it.
    const hash=await db.from('users').select('password_hash').eq('id',u.id).single();
    if(hash.error || !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash.data?.password_hash || '')) throw new Error('Unsupported legacy credential; import stopped.');
    const {data,error:createdError}=await db.auth.admin.createUser({id:u.id,email,email_confirm:true,password_hash:hash.data.password_hash,
      user_metadata:{full_name:u.full_name,role:u.role},app_metadata:{legacy_import:true}});
    if(createdError || data.user?.id!==u.id) throw new Error('Auth import failed; retain all records and inspect before retrying.');
    const linked=await db.from('users').select('auth_user_id').eq('id',u.id).single();
    if(linked.error || linked.data?.auth_user_id!==u.id) throw new Error('Auth/profile linkage failed.');
    results.push({id:u.id,result:'imported; same profile ID'});
  }
  return results;
}
if(require.main===module){
 require('dotenv').config({path:path.join(__dirname,'../.env'),quiet:true});
 const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 importLegacy(db,process.argv.includes('--apply')).then(results=>console.log(JSON.stringify(results,null,2))).catch(()=>{console.error('Legacy import stopped. No records were deleted. Check configuration and reviewed cohort; do not print credentials.');process.exitCode=1;});
}
module.exports={importLegacy};
