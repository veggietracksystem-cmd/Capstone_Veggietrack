const test=require('node:test');
const assert=require('node:assert/strict');
const {Webhook}=require('standardwebhooks');
const {createSmsHook}=require('../lib/smsHook');
const {createVerifier}=require('../lib/auth');
const {normalizePhone,isValidPhone}=require('../../mobile/src/lib/phone');
const response=()=>({statusCode:200,status(n){this.statusCode=n;return this;},json(value){this.body=value;return this;}});
test('one PH helper accepts all four forms and rejects invalid/international values',()=>{
 for(const value of ['09171234567','9171234567','+639171234567','639171234567','0917 123-4567']){assert.equal(normalizePhone(value),'+639171234567');assert.equal(isValidPhone(value),true);}
 for(const value of ['+14155552671','0917123456','638071234567','abc09171234567',null,{},'+639171234567,639171234567'])assert.equal(isValidPhone(value),false);
});
const secret=Buffer.from('only-a-test-signing-secret-1234567').toString('base64');
const env={SEND_SMS_HOOK_SECRET:`v1,whsec_${secret}`,PHILSMS_API_TOKEN:'test-token',PHILSMS_SENDER_ID:'TEST',PHILSMS_DELIVERY_ENABLED:'true'};
function signed(payload){const body=JSON.stringify(payload),id='test-hook',date=new Date();return {body:Buffer.from(body),headers:{'webhook-id':id,'webhook-timestamp':String(Math.floor(date/1000)),'webhook-signature':new Webhook(secret).sign(id,date,body)}};}
const payload={user:{id:'user',phone:'+639171234567'},sms:{otp:'123456'}};
test('valid signed SMS sends documented PhilSMS body; change code uses NEW destination',async()=>{
 for(const body of [payload,{...payload,sms:{otp:'123456',phone:'639181234567'}}]){
  let count=0;
  const handler=createSmsHook({env,fetchImpl:async(url,options)=>{count++;assert.equal(url,'https://app.philsms.com/api/v3/sms/send');const sent=JSON.parse(options.body);assert.equal(sent.recipient,body.sms.phone || '639171234567');assert.equal(sent.type,'plain');assert.equal(sent.sender_id,'TEST');return {ok:true,json:async()=>({status:'success'})};}});
  const res=response();await handler(signed(body),res);assert.equal(res.statusCode,200);assert.equal(count,1);
 }
});
test('invalid signature and payload never call SMS provider',async()=>{
 for(const [config,req,expected] of [[env,{...signed(payload),headers:{}},401],[env,signed({user:{id:'u',phone:'wrong'},sms:{otp:'123456'}}),400]]){
  const res=response();await createSmsHook({env:config,fetchImpl:()=>assert.fail('SMS not allowed')})(req,res);assert.equal(res.statusCode,expected);
 }
});
test('production config failures are fail-closed',async()=>{
 for(const [config,expected] of [[{...env,NODE_ENV:'production',PHILSMS_DELIVERY_ENABLED:'false'},503],[{...env,NODE_ENV:'production',PHILSMS_API_TOKEN:'',PHILSMS_SENDER_ID:''},503]]){
  const res=response();await createSmsHook({env:config,fetchImpl:()=>assert.fail('SMS not allowed when misconfigured')})(signed(payload),res);assert.equal(res.statusCode,expected);
 }
});
test('development mode disables real PhilSMS delivery without failing auth hooks',async()=>{
 const res=response();
 const req=signed(payload);
 await createSmsHook({env:{...env,PHILSMS_DELIVERY_ENABLED:'false',NODE_ENV:'development'},fetchImpl:()=>assert.fail('SMS not allowed in development')})(req,res);
 assert.equal(res.statusCode,200);
 assert.equal(res.body.mode,'development-skip');
});
test('HTTP, provider-level, malformed JSON and network failures return safe failures',async()=>{
 for(const fetchImpl of [async()=>({ok:false}),async()=>({ok:true,json:async()=>({status:'error',message:'secret provider details'})}),async()=>({ok:true,json:async()=>{throw Error('secret');}}),async()=>{throw Error('secret');}]){
  const res=response();await createSmsHook({env,fetchImpl})(signed(payload),res);assert.equal(res.statusCode,502);assert.ok(!JSON.stringify(res.body).includes('secret'));
 }
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
test('ambiguous older hook phone-change payload cannot send a code to the wrong number',async()=>{
 const res=response();await createSmsHook({env,fetchImpl:()=>assert.fail('Destination is ambiguous')})(signed({user:{id:'u',phone:'639171234567',new_phone:'639181234567'},sms:{otp:'123456'}}),res);assert.equal(res.statusCode,400);
});
test('auth/mobile source contains no direct PhilSMS calls, server credentials, or OTP logging',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
 for(const file of walk(path.join(__dirname,'../../mobile/src')).filter(f=>/\.js$/.test(f))){
  const source=fs.readFileSync(file,'utf8');assert.doesNotMatch(source,/PHILSMS|SUPABASE_SERVICE_KEY|SEND_SMS_HOOK_SECRET|firebase\/auth/);
 }
 assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'../lib/smsHook.js'),'utf8'),/console\./);
});
