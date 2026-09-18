import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { api, setAuthToken, setUnauthorizedHandler, setBlockedHandler, setTokenProvider } from '../api/client';
import { supabase, authConfigured, clearStoredSession } from '../lib/supabase';
import { clearAll } from '../offline/db';
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
 const [user,setUser]=useState(null), [session,setSession]=useState(null), [loading,setLoading]=useState(true);
 const [statusError,setStatusError]=useState(''), [recoveryMode,setRecoveryMode]=useState(false);
 const [initialRoute,setInitialRoute]=useState('Landing');
 const generation=useRef(0), alive=useRef(true);
 const refreshProfile=async()=>{
  const version=++generation.current;
  try {
   const {data,error}=await supabase.auth.getSession();
   if(error) throw error;
   if(!alive.current || version!==generation.current) return;
   const current=data.session;
   setSession(current); setAuthToken(current?.access_token || null);
   if(!current){setUser(null);setStatusError('');return;}
   const result=await api.get('/api/auth/me');
   if(alive.current && version===generation.current){setUser(result.user);setStatusError('');}
  } catch {
   if(alive.current && version===generation.current){setUser(null);setStatusError('Account status could not be checked. Reconnect and refresh.');}
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
  const {data:{subscription}}=supabase.auth.onAuthStateChange(()=>{setTimeout(()=>{if(alive.current)void refreshProfile();},0);});
  const timer=setInterval(()=>{if(AppState.currentState==='active')void refreshProfile();},15000);
  const appSub=AppState.addEventListener('change',state=>{
   // Re-check status in the background on foreground, but don't blank the
   // already-known user first - that briefly routed active users through
   // ApplicationStatusScreen on every app open before refreshProfile()
   // resolved. refreshProfile() still clears/updates user itself once the
   // recheck completes, so a real status change is never missed.
   if(state==='active'){supabase.auth.startAutoRefresh();void refreshProfile();}
   else {supabase.auth.stopAutoRefresh();setUser(null);}
  });
  return ()=>{alive.current=false;generation.current++;subscription.unsubscribe();appSub.remove();clearInterval(timer);setUnauthorizedHandler(null);setBlockedHandler(null);setTokenProvider(null);};
 },[]);
 const signInWithEmail=async(email,password)=>{const {error}=await supabase.auth.signInWithPassword({email,password});if(error)throw error;await refreshProfile();};
 return <AuthContext.Provider value={{user,session,token:session?.access_token,loading,initialRoute,statusError,recoveryMode,setRecoveryMode,signInWithEmail,signOut,refreshProfile,updateUser:refreshProfile}}>{children}</AuthContext.Provider>;
}
export function useAuth(){return useContext(AuthContext);}
