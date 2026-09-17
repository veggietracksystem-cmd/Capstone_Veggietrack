import {useState,useEffect,useRef} from 'react';
import {Text,View,ActivityIndicator} from 'react-native';
import {AuthPage,AuthButton,AuthInput,authStyles as s} from '../components/AuthForm';
import {api} from '../api/client';
import {confirmAction} from '../lib/ui';
const filters=['pending_approval','active','declined','disabled','unverified'];
export default function AccountManagementScreen({navigation}){
 const [status,setStatus]=useState('pending_approval'),[users,setUsers]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reasons,setReasons]=useState({}),[audit,setAudit]=useState({});
 const [loading,setLoading]=useState(false),[auditBusy,setAuditBusy]=useState(null);
 const lock=useRef(false),generation=useRef(0);
 const load=async()=>{const version=++generation.current;setError('');setLoading(true);try{const rows=await api.get(`/api/accounts?status=${status}`);if(version===generation.current)setUsers(rows);}catch(e){if(version===generation.current)setError(e.message);}finally{if(version===generation.current)setLoading(false);}};
 useEffect(()=>{setUsers([]);void load();return()=>{generation.current++;};},[status]);
 const act=(user,action)=>{
  const reason=(reasons[user.id] || '').trim();
  if(['DECLINED','DISABLED'].includes(action)&&!reason){setError('Enter a user-facing reason first.');return;}
  confirmAction('Confirm account action',`${action}: ${user.full_name}${reason?'\nReason: '+reason:''}`,async()=>{
   if(lock.current)return;lock.current=true;setBusy(true);setError('');
   try{await api.post(`/api/accounts/${user.id}/transition`,{action,reason,version:user.status_version});setAudit({});await load();}catch(e){setError(e.message);}finally{lock.current=false;setBusy(false);}
  });
 };
 return <AuthPage title="User Management">
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:5}}>{filters.map(f=><AuthButton key={f} title={f.replace('_',' ').toUpperCase()} disabled={busy || status===f} onPress={()=>setStatus(f)}/>)}</View>
  <AuthButton title="Refresh" disabled={busy || loading} onPress={load}/>
  {!!error&&<Text style={s.error}>{error}</Text>}
  {loading&&<ActivityIndicator accessibilityLabel="Loading accounts"/>}
  {!loading&&!users.length&&<Text style={s.note}>No accounts in this view.</Text>}
  {users.map(u=><View key={u.id} style={{padding:16,backgroundColor:'#fff',borderRadius:10,marginVertical:8}}>
   <Text style={{fontWeight:'bold'}}>{u.full_name} — {u.role==='delivery_personnel'?'Rider':u.role}</Text>
   <Text>{u.phone} · {u.phone_verified_at?'SMS verified':u.legacy_access?'Existing account':'Unverified'}</Text>
   <Text>{u.farm_location || u.store_location || u.service_area}</Text><Text>Applied: {new Date(u.created_at).toLocaleString()}</Text>
   {!!u.status_reason&&<Text>{u.status_reason}</Text>}
   {!!u.unfinished_assignments?.length&&<Text style={s.error}>Distributor attention: {u.unfinished_assignments.length} unfinished assignments. {u.unfinished_assignments.map(a=>`${a.type} ${a.id.slice(0,8)} (${a.status})`).join(', ')}</Text>}
   {['active','pending_approval'].includes(status)&&<AuthInput placeholder="Reason (visible to this user)" maxLength={500} value={reasons[u.id] || ''} onChangeText={v=>setReasons(r=>({...r,[u.id]:v}))}/>}
   {status==='pending_approval'&&<><AuthButton title="Approve" disabled={busy} onPress={()=>act(u,'APPROVED')}/><AuthButton title="Decline" disabled={busy} onPress={()=>act(u,'DECLINED')}/></>}
   {status==='active'&&<AuthButton title="Disable" disabled={busy} onPress={()=>act(u,'DISABLED')}/>}
   {status==='disabled'&&<AuthButton title="Reactivate (fresh login required)" disabled={busy} onPress={()=>act(u,'REACTIVATED')}/>}
   <AuthButton title="Audit history" disabled={auditBusy!==null} onPress={async()=>{if(auditBusy!==null)return;setAuditBusy(u.id);try{const rows=await api.get(`/api/accounts/${u.id}/audit`);setAudit(a=>({...a,[u.id]:rows}));}catch(e){setError(e.message);}finally{setAuditBusy(null);}}}/>
   {audit[u.id]?.map(a=><Text key={a.id}>{new Date(a.created_at).toLocaleString()} · {a.action} · {a.previous_status} → {a.resulting_status}{a.reason?' · '+a.reason:''}</Text>)}
  </View>)}
  <AuthButton title="Back" onPress={()=>navigation.goBack()}/>
 </AuthPage>;
}
