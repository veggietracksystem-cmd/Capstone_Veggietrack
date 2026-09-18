const test=require('node:test');
const assert=require('node:assert/strict');
const {createVerifier}=require('../lib/auth');
const {normalizePhone,isValidPhone}=require('../../mobile/src/lib/phone');
const response=()=>({statusCode:200,status(n){this.statusCode=n;return this;},json(value){this.body=value;return this;}});
test('one PH helper accepts all four forms and rejects invalid/international values',()=>{
 for(const value of ['09171234567','9171234567','+639171234567','639171234567','0917 123-4567']){assert.equal(normalizePhone(value),'+639171234567');assert.equal(isValidPhone(value),true);}
 for(const value of ['+14155552671','0917123456','638071234567','abc09171234567',null,{},'+639171234567,639171234567'])assert.equal(isValidPhone(value),false);
});
test('verified Auth session still requires authoritative ACTIVE status; status-only access works',async()=>{
 const token='x.'+Buffer.from(JSON.stringify({sub:'u',session_id:'s'})).toString('base64url')+'.x';
 for(const status of ['unverified','pending_approval','declined','disabled','active']){
  const client={auth:{getUser:async()=>({data:{user:{id:'u'}}})},rpc:async()=>({data:{id:'u',role:'farmer',account_status:status,access_allowed:status==='active'}})};
  for(const statusOnly of [false,true]){let passed=false;const res=response();await createVerifier(client,statusOnly)({headers:{authorization:`Bearer ${token}`}},res,()=>{passed=true;});assert.equal(passed,statusOnly || status==='active');}
 }
 const client={auth:{getUser:async()=>({data:{user:{id:'u'}}})},rpc:async()=>({data:null})};
 const res=response();await createVerifier(client)({headers:{authorization:`Bearer ${token}`}},res,()=>assert.fail('Old session accepted'));assert.equal(res.statusCode,401);
});

const {requestPhoneChange,verifyPhoneChange}=require('../../mobile/src/lib/phoneChange');
test('phone change rejects invalid/same numbers before requesting SMS; verification belongs to Supabase',async()=>{
 for(const phone of ['wrong','9171234567'])await assert.rejects(requestPhoneChange({updateUser:()=>assert.fail('No SMS allowed')},'+639171234567',phone));
 let calls=[];
 const auth={updateUser:async args=>{calls.push(args);return {};},verifyOtp:async args=>{calls.push(args);return {};},getUser:async()=>({data:{user:{id:'same-id',phone:'639181234567'}}})};
 await requestPhoneChange(auth,'09171234567','9181234567');
 assert.deepEqual(calls,[{phone:'+639181234567'}]);
 const user=await verifyPhoneChange(auth,'same-id','09181234567','123456');
 assert.equal(user.id,'same-id');assert.equal(calls[1].type,'phone_change');assert.equal(calls[1].phone,'+639181234567');
 await assert.rejects(verifyPhoneChange(auth,'another-id','09181234567','123456'),/Identity/);
});
test('SMS rejection/duplicate/expired/incorrect OTP cannot perform profile writes',async()=>{
 for(const code of ['phone_exists','over_sms_send_rate_limit','provider_failure'])await assert.rejects(requestPhoneChange({updateUser:async()=>({error:{code}})},'09171234567','09181234567'));
 for(const code of ['otp_expired','incorrect_otp'])await assert.rejects(verifyPhoneChange({verifyOtp:async()=>({error:{code}}),getUser:()=>assert.fail('Failed verification cannot complete')},'same-id','09181234567','000000'));
});
