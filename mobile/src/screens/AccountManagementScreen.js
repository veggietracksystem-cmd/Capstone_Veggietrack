import {rf} from '../lib/responsive';
import {useState,useEffect,useRef} from 'react';
import {Text,View,ActivityIndicator,ScrollView,StyleSheet} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AuthButton,AuthInput,authStyles as s} from '../components/AuthForm';
import ScreenHeader from '../components/ScreenHeader';
import StatusBadge from '../components/ui/StatusBadge';
import {colors,fonts,fontSize,radius,shadowCard} from '../theme/appTheme';
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
 return <SafeAreaView style={styles.page} edges={['top','left','right']}>
  <ScreenHeader title="User Management" onBack={()=>navigation.goBack()}/>
  <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:6,marginBottom:8}}>{filters.map(f=><AuthButton key={f} title={f.replace('_',' ').toUpperCase()} size="sm" variant={status===f?'primary':'outline'} disabled={busy || status===f} onPress={()=>setStatus(f)}/>)}</View>
  <AuthButton title="Refresh" size="sm" variant="outline" disabled={busy || loading} onPress={load}/>
  {!!error&&<Text style={s.error}>{error}</Text>}
  {loading&&<ActivityIndicator accessibilityLabel="Loading accounts" color={colors.leaf700}/>}
  {!loading&&!users.length&&<Text style={s.note}>No accounts in this view.</Text>}
  {users.map(u=><View key={u.id} style={styles.card}>
   <View style={styles.cardHeaderRow}>
     <Text style={styles.name}>{u.full_name} — {u.role==='delivery_personnel'?'Rider':u.role}</Text>
     <StatusBadge status={u.account_status || status}/>
   </View>
   <Text style={styles.meta}>{u.phone} · {u.phone_verified_at?'SMS verified':u.legacy_access?'Existing account':'Unverified'}</Text>
   <Text style={styles.meta}>{u.farm_location || u.store_location || u.service_area}</Text><Text style={styles.meta}>Applied: {new Date(u.created_at).toLocaleString()}</Text>
   {!!u.status_reason&&<Text style={styles.meta}>{u.status_reason}</Text>}
   {!!u.unfinished_assignments?.length&&<Text style={s.error}>Distributor attention: {u.unfinished_assignments.length} unfinished assignments. {u.unfinished_assignments.map(a=>`${a.type} ${a.id.slice(0,8)} (${a.status})`).join(', ')}</Text>}
   {['active','pending_approval'].includes(status)&&<AuthInput placeholder="Reason (visible to this user)" maxLength={500} value={reasons[u.id] || ''} onChangeText={v=>setReasons(r=>({...r,[u.id]:v}))}/>}
   {status==='pending_approval'&&<View style={styles.actionRow}><AuthButton title="Approve" size="sm" disabled={busy} onPress={()=>act(u,'APPROVED')}/><AuthButton title="Decline" size="sm" variant="danger" disabled={busy} onPress={()=>act(u,'DECLINED')}/></View>}
   {status==='active'&&<AuthButton title="Disable" size="sm" variant="danger" disabled={busy} onPress={()=>act(u,'DISABLED')}/>}
   {status==='disabled'&&<AuthButton title="Reactivate (fresh login required)" size="sm" disabled={busy} onPress={()=>act(u,'REACTIVATED')}/>}
   <AuthButton title="Audit history" size="sm" variant="ghost" disabled={auditBusy!==null} onPress={async()=>{if(auditBusy!==null)return;setAuditBusy(u.id);try{const rows=await api.get(`/api/accounts/${u.id}/audit`);setAudit(a=>({...a,[u.id]:rows}));}catch(e){setError(e.message);}finally{setAuditBusy(null);}}}/>
   {audit[u.id]?.map(a=><Text key={a.id} style={styles.meta}>{new Date(a.created_at).toLocaleString()} · {a.action} · {a.previous_status} → {a.resulting_status}{a.reason?' · '+a.reason:''}</Text>)}
  </View>)}
  </ScrollView>
 </SafeAreaView>;
}
const styles=StyleSheet.create({
 page:{flex:1,backgroundColor:colors.bgScreen},
 content:{padding:20},
 card:{padding:16,backgroundColor:colors.card,borderRadius:radius.card,marginVertical:8,borderWidth:1,borderColor:colors.border,...shadowCard},
 cardHeaderRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8,marginBottom:4},
 actionRow:{flexDirection:'row',gap:8,marginTop:4},
 name:{flex:1,fontFamily:fonts.bodySemiBold,fontSize:rf(fontSize.md),color:colors.ink},
 meta:{fontFamily:fonts.body,fontSize:rf(fontSize.sm),color:colors.inkSoft,marginTop:2},
});
