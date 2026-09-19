const test=require('node:test');
const assert=require('node:assert/strict');
const {createVerifier}=require('../lib/auth');
const response=()=>({statusCode:200,status(n){this.statusCode=n;return this;},json(value){this.body=value;return this;}});
test('an Auth session still requires authoritative active account status',async()=>{
 const token='x.'+Buffer.from(JSON.stringify({sub:'u',session_id:'s'})).toString('base64url')+'.x';
 for(const status of ['unverified','pending_approval','declined','disabled','active']){
  const client={auth:{getUser:async()=>({data:{user:{id:'u'}}})},rpc:async()=>({data:{id:'u',role:'farmer',account_status:status,access_allowed:status==='active'}})};
  let passed=false;const res=response();await createVerifier(client)({headers:{authorization:`Bearer ${token}`}},res,()=>{passed=true;});assert.equal(passed,status==='active');
 }
});
