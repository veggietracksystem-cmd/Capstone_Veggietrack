import { useState, useEffect, useRef } from 'react';
import { Text } from 'react-native';
import { AuthPage, AuthInput, AuthButton, authStyles as s } from '../components/AuthForm';
import { supabase, authConfigured } from '../lib/supabase';
import { normalizePhone, isValidPhone, maskPhone, PHONE_HINT } from '../lib/phone';
import { authError } from '../lib/authErrors';
import { useAuth } from '../context/AuthContext';
export default function PhoneOtpScreen({navigation,route}) {
 const mode=route?.name==='ForgotPassword'?'recovery':route?.name==='PhoneOtp'?'verify':'login';
 const {signIn,refreshProfile,setRecoveryMode,signOut}=useAuth();
 const [phone,setPhone]=useState(route?.params?.phone || ''),[password,setPassword]=useState(''),[otp,setOtp]=useState('');
 const [phase,setPhase]=useState(mode==='verify'?'otp':'phone'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[cooldown,setCooldown]=useState(mode==='verify'?60:0);
 const lock=useRef(false);
 useEffect(()=>{const timer=setInterval(()=>setCooldown(n=>Math.max(0,n-1)),1000);return()=>clearInterval(timer);},[]);
 const run=async(fn)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError(authError(e));}finally{lock.current=false;setBusy(false);}};
 const send=()=>run(async()=>{
  if(!isValidPhone(phone)){setError(PHONE_HINT);return;}
  const p=normalizePhone(phone);
  const result=mode==='recovery'?await supabase.auth.signInWithOtp({phone:p,options:{shouldCreateUser:false}}):await supabase.auth.resend({type:'sms',phone:p});
  if(result.error)throw result.error;setCooldown(60);setPhase('otp');
 });
 const verify=()=>run(async()=>{
  if(mode==='recovery')setRecoveryMode(true);
  const {error}=await supabase.auth.verifyOtp({phone:normalizePhone(phone),token:otp,type:'sms'});
  if(error){if(mode==='recovery')setRecoveryMode(false);throw error;}
  setOtp('');
  if(mode==='recovery')setPhase('password');else await refreshProfile();
 });
 const cancel=async()=>{if(mode==='recovery')await signOut({redirectToLogin:true});navigation?.navigate('Login');};
 return <AuthPage title={mode==='login'?'Sign in':mode==='recovery'?'Reset password':'Verify your mobile number'}>
  {!authConfigured && <Text style={s.error}>Supabase configuration is required.</Text>}
  {phase==='phone' && <><AuthInput placeholder="Mobile number" accessibilityLabel="Mobile number" keyboardType="phone-pad" value={phone} onChangeText={setPhone}/>
   {mode==='login' && <AuthInput placeholder="Password" accessibilityLabel="Password" secureTextEntry value={password} onChangeText={setPassword}/>}
   <AuthButton title={mode==='login'?'Sign in':'Send Verification Code'} disabled={busy || !authConfigured} onPress={mode==='login'?()=>run(async()=>{if(!isValidPhone(phone)){setError(PHONE_HINT);return;}await signIn(normalizePhone(phone),password);}):send}/>
   {mode==='login' && <><AuthButton title="Create account" onPress={()=>navigation.navigate('Register')}/><AuthButton title="Forgot password" onPress={()=>navigation.navigate('ForgotPassword')}/><AuthButton title="Finish phone verification" onPress={()=>{if(isValidPhone(phone)){setPhase('otp');}else setError(PHONE_HINT);}}/></>}
  </>}
  {phase==='otp' && <><Text style={s.note}>{maskPhone(phone)}</Text><AuthInput placeholder="Verification code" accessibilityLabel="Verification code" keyboardType="number-pad" value={otp} onChangeText={setOtp} maxLength={10}/><AuthButton title="Verify" disabled={busy || !otp} onPress={verify}/><AuthButton title={cooldown?`Resend in ${cooldown}s`:'Resend Code'} disabled={busy || cooldown>0} onPress={send}/></>}
  {phase==='password' && <><AuthInput placeholder="New password (at least 8 characters)" secureTextEntry value={password} onChangeText={setPassword}/><AuthButton title="Save password" disabled={busy || password.length<8} onPress={()=>run(async()=>{const {error}=await supabase.auth.updateUser({password});if(error)throw error;setPassword('');await signOut({redirectToLogin:true});})}/></>}
  {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
  {mode!=='login' && <AuthButton title="Cancel" disabled={busy} onPress={cancel}/>}
 </AuthPage>;
}
