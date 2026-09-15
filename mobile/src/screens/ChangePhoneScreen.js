import {useState,useEffect,useRef} from 'react';
import {Text} from 'react-native';
import {AuthPage,AuthInput,AuthButton,authStyles as s} from '../components/AuthForm';
import {useAuth} from '../context/AuthContext';
import {supabase} from '../lib/supabase';
import {normalizePhone,isValidPhone,maskPhone,PHONE_HINT} from '../lib/phone';
import {authError} from '../lib/authErrors';
import {requestPhoneChange,verifyPhoneChange} from '../lib/phoneChange';
import {showAlert} from '../lib/ui';
export default function ChangePhoneScreen({navigation}){
 const {user,refreshProfile}=useAuth();
 const [phone,setPhone]=useState(''),[otp,setOtp]=useState(''),[phase,setPhase]=useState('entry'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[cooldown,setCooldown]=useState(0);
 const lock=useRef(false),expectedId=useRef(user.auth_user_id);
 useEffect(()=>{const timer=setInterval(()=>setCooldown(n=>Math.max(0,n-1)),1000);return()=>clearInterval(timer);},[]);
 const run=async(fn)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError(authError(e));}finally{lock.current=false;setBusy(false);}};
 const review=()=>{setError('');if(!isValidPhone(phone)){setError(PHONE_HINT);return;}if(normalizePhone(phone)===normalizePhone(user.phone)){setError('This is already your registered mobile number.');return;}setPhone(normalizePhone(phone));setPhase('confirm');};
 const send=()=>run(async()=>{await requestPhoneChange(supabase.auth,user.phone,phone);setPhase('otp');setCooldown(60);});
 const verify=()=>run(async()=>{
  await verifyPhoneChange(supabase.auth,expectedId.current,phone,otp);
  setOtp('');await refreshProfile();showAlert('Mobile number','Your mobile number has been changed successfully.');navigation.goBack();
 });
 return <AuthPage title={phase==='otp'?'Verify your new mobile number':'Change mobile number'}>
  {phase==='entry' && <><Text style={s.note}>Current: {maskPhone(user.phone)}</Text><AuthInput placeholder="New mobile number" keyboardType="phone-pad" value={phone} onChangeText={setPhone}/><AuthButton title="Continue" onPress={review}/></>}
  {phase==='confirm' && <><Text style={s.note}>Current: {maskPhone(user.phone)}{'\n'}New: {phone}{'\n'}We'll send a verification code to your new mobile number.</Text><AuthButton title="Send Verification Code" disabled={busy} onPress={send}/></>}
  {phase==='otp' && <><Text style={s.note}>{maskPhone(phone)}</Text><AuthInput placeholder="Verification code" keyboardType="number-pad" value={otp} onChangeText={setOtp} maxLength={10}/><AuthButton title="Verify" disabled={busy || !otp} onPress={verify}/><AuthButton title={cooldown?`Resend in ${cooldown}s`:'Resend Code'} disabled={busy || cooldown>0} onPress={send}/></>}
  {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
  <AuthButton title="Cancel" disabled={busy} onPress={()=>navigation.goBack()}/>
 </AuthPage>;
}
