import {Text,View,StyleSheet} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useAuth} from '../context/AuthContext';
import {AuthPage,AuthButton,authStyles as s} from '../components/AuthForm';
import {colors} from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';

// Icon + tint per account_status, purely visual — the status values themselves
// (and the messages they map to below) are unchanged.
const STATUS_ICONS = {
 unverified:{name:'mail-unread-outline',bg:colors.gold100,color:colors.gold700},
 pending_approval:{name:'time-outline',bg:colors.gold100,color:colors.gold700},
 declined:{name:'close-circle-outline',bg:colors.dangerSoft,color:colors.danger},
 disabled:{name:'alert-circle-outline',bg:colors.dangerSoft,color:colors.danger},
};
const DEFAULT_ICON={name:'help-circle-outline',bg:colors.leaf100,color:colors.leaf700};
// A status we could not read is a connectivity problem, not an account verdict.
// Framing it as one alarmed users whose only fault was a slow connection.
const OFFLINE_ICON={name:'cloud-offline-outline',bg:colors.gold100,color:colors.gold700};

export default function ApplicationStatusScreen(){
  const { t } = useTranslation();
 const {user,statusError,refreshProfile,signOut}=useAuth();
 const messages={unverified:t('authx.statusUnverified'),pending_approval:t('authx.statusPending'),declined:t('authx.statusDeclined'),disabled:t('authx.statusDisabled')};
 const icon=statusError?OFFLINE_ICON:(STATUS_ICONS[user?.account_status]||DEFAULT_ICON);
 return <AuthPage title={statusError?t('authx.connectionProblem'):t('authx.accountStatus')}>
  <View style={[styles.iconWrap,{backgroundColor:icon.bg}]}><Ionicons name={icon.name} size={34} color={icon.color}/></View>
  <Text style={[s.note,styles.centerNote]}>{statusError || messages[user?.account_status] || t('authx.statusChecking')}</Text>
  {!!user?.status_reason && <Text style={[s.note,styles.centerNote]}>{user.status_reason}</Text>}
  <AuthButton title={statusError?t('authx.tryAgain'):t('authx.refreshStatus')} onPress={refreshProfile}/>
  <AuthButton variant="ghost" title={t('authx.logout')} onPress={()=>signOut({redirectToLogin:true})}/>
 </AuthPage>;
}

const styles=StyleSheet.create({
 iconWrap:{width:84,height:84,borderRadius:42,alignItems:'center',justifyContent:'center',alignSelf:'center',marginBottom:18},
 centerNote:{textAlign:'center'},
});
