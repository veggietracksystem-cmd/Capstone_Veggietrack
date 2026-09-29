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
    // Skip while the email challenge holds a temporary password session; publishing
    // it would switch to the signed-in stack before the code is entered.
    if(challenge.current) return;
    const version=++generation.current;
    try {
      const {data,error}=await supabase.auth.getSession();
      if(error) throw error;
      if(!alive.current || version!==generation.current) return;
      const current=data.session;
      setSession(current); setAuthToken(current?.access_token || null);
      if(!current){setUser(null);setStatusError('');return;}
      // Retry a network failure once before reporting an error.
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
      // Keep an already-loaded user on transient failures; the error is shown only
      // when there is no user to fall back on. The poll and foreground refresh retry.
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
    // Password reset links use PKCE on native: exchange the code before entering recovery mode.
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
      // Re-check the account on foreground without clearing the current user, which
      // would route through the account-status screen and reset the stack.
      if(state==='active'){supabase.auth.startAutoRefresh();void refreshProfile();}
      else supabase.auth.stopAutoRefresh();
    });
    return ()=>{alive.current=false;generation.current++;subscription.unsubscribe();linkSub.remove();appSub.remove();clearInterval(timer);setUnauthorizedHandler(null);setBlockedHandler(null);setTokenProvider(null);};
  },[]);
  const signInWithEmail=async(email,password)=>{
    // Held for the whole challenge, since the auth listener reacts on a timer.
    challenge.current=true;
    try {
      const {error}=await supabase.auth.signInWithPassword({email,password});
      if(error)throw error;
      // Clear the password session before the email challenge so it cannot enter the app.
      const {error:otpError}=await supabase.auth.signInWithOtp({email,options:{shouldCreateUser:false}});
      await supabase.auth.signOut({scope:'local'});
      if(otpError)throw otpError;
    } finally { challenge.current=false; }
  };
  return <AuthContext.Provider value={{user,session,token:session?.access_token,loading,initialRoute,statusError,recoveryMode,signInWithEmail,signOut,refreshProfile,updateUser:refreshProfile}}>{children}</AuthContext.Provider>;
}
export function useAuth(){return useContext(AuthContext);}
