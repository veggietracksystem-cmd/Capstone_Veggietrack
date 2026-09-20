import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Linking from 'expo-linking';
import { api, setAuthToken, setUnauthorizedHandler, setBlockedHandler, setTokenProvider } from '../api/client';
import { supabase, authConfigured, clearStoredSession } from '../lib/supabase';
import { clearAll } from '../offline/db';
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
 const [user,setUser]=useState(null), [session,setSession]=useState(null), [loading,setLoading]=useState(true);
 const [statusError,setStatusError]=useState(''), [recoveryMode,setRecoveryMode]=useState(false);
 const [initialRoute,setInitialRoute]=useState('Landing');
 const generation=useRef(0), alive=useRef(true), challenge=useRef(false);
 const refreshProfile=async()=>{
  // The email challenge below holds a password session just long enough to
  // request the code. Publishing that session would swap the navigator to the
  // signed-in stack, so the Login screen's VerifyEmail navigation would land
  // on a stack that no longer has the screen and be dropped.
  if(challenge.current) return;
  const version=++generation.current;
  try {
   const {data,error}=await supabase.auth.getSession();
   if(error) throw error;
   if(!alive.current || version!==generation.current) return;
   const current=data.session;
   setSession(current); setAuthToken(current?.access_token || null);
   if(!current){setUser(null);setStatusError('');return;}
   // One hosted read can lose to a cold start or a dropped mobile connection.
   // Retry a transport failure once, quietly, so a blip never reaches a screen.
   let result;
   try { result=await api.get('/api/auth/me'); }
   catch (firstAttempt) {
    if(!alive.current || version!==generation.current) return;
    if(firstAttempt?.status>=400 && firstAttempt?.status!==503) throw firstAttempt;
    await new Promise(resolve=>setTimeout(resolve,1500));
    if(!alive.current || version!==generation.current) return;
    result=await api.get('/api/auth/me');
   }
   if(alive.current && version===generation.current){setUser(result.user);setStatusError('');}
  } catch {
   // A transient failure here (flaky connection, slow backend) must not
   // boot an already-active user out to the Account Status screen - only
   // show that error when we have nothing to fall back on. Retries happen
   // silently via the 15s poll / foreground refresh below.
   if(alive.current && version===generation.current){
    setUser(current=>{setStatusError(current?'':'We can’t reach VeggieTrack right now. Check your connection and try again.');return current;});
   }
  } finally {if(alive.current && version===generation.current)setLoading(false);}
 };
 const signOut=async(opts={})=>{
  generation.current++; setInitialRoute(opts.redirectToLogin?'Login':'Landing');
  setUser(null);setSession(null);setAuthToken(null);setStatusError('');setRecoveryMode(false);
  try { await supabase.auth.signOut({scope:'local'}); }
  finally { await clearStoredSession(); }
  await clearAll();
 };
 useEffect(()=>{
  alive.current=true;
  setTokenProvider(async()=>{const {data}=await supabase.auth.getSession();return data.session?.access_token || null;});
  setUnauthorizedHandler(()=>{void signOut({redirectToLogin:true});});
  setBlockedHandler(()=>{setUser(null);void refreshProfile();});
  if(authConfigured) void refreshProfile(); else setLoading(false);
  // Password-reset links use PKCE on native. Exchange the code from our
  // application URL before exposing the short-lived recovery session.
  const recoverFromUrl=async(url)=>{
   const parsed=Linking.parse(url);
   if(parsed.path!=='reset-password') return;
   const code=parsed.queryParams?.code;
   if(!code) return;
   const {error}=await supabase.auth.exchangeCodeForSession(String(code));
   if(!error && alive.current){setRecoveryMode(true);void refreshProfile();}
  };
  void Linking.getInitialURL().then(url=>{if(url) void recoverFromUrl(url);});
  const linkSub=Linking.addEventListener('url',({url})=>{void recoverFromUrl(url);});
  const {data:{subscription}}=supabase.auth.onAuthStateChange((event)=>{
   if(event==='PASSWORD_RECOVERY' && alive.current) setRecoveryMode(true);
   setTimeout(()=>{if(alive.current)void refreshProfile();},0);
  });
  const timer=setInterval(()=>{if(AppState.currentState==='active')void refreshProfile();},15000);
  const appSub=AppState.addEventListener('change',state=>{
   // Re-check status on foreground, but never blank the already-known user -
   // on either edge. The navigator swaps to ApplicationStatusScreen while user
   // is null, so clearing it routed active users through that screen on every
   // app open and reset the stack, dropping riders and retailers back to their
   // dashboard root. refreshProfile() still clears/updates user itself once the
   // recheck completes, so a real status change is never missed.
   if(state==='active'){supabase.auth.startAutoRefresh();void refreshProfile();}
   else supabase.auth.stopAutoRefresh();
  });
  return ()=>{alive.current=false;generation.current++;subscription.unsubscribe();linkSub.remove();appSub.remove();clearInterval(timer);setUnauthorizedHandler(null);setBlockedHandler(null);setTokenProvider(null);};
 },[]);
 const signInWithEmail=async(email,password)=>{
  // Held for the whole challenge, not just the signed-in moment: the auth
  // listener below reacts on a timer, so the flag has to outlive both the
  // sign-in and the sign-out events this function provokes.
  challenge.current=true;
  try {
   const {error}=await supabase.auth.signInWithPassword({email,password});
   if(error)throw error;
   // Password verification is followed by a separate email challenge. Clear
   // the password session before the challenge so it cannot enter the app.
   const {error:otpError}=await supabase.auth.signInWithOtp({email,options:{shouldCreateUser:false}});
   await supabase.auth.signOut({scope:'local'});
   if(otpError)throw otpError;
  } finally { challenge.current=false; }
 };
 return <AuthContext.Provider value={{user,session,token:session?.access_token,loading,initialRoute,statusError,recoveryMode,signInWithEmail,signOut,refreshProfile,updateUser:refreshProfile}}>{children}</AuthContext.Provider>;
}
export function useAuth(){return useContext(AuthContext);}
