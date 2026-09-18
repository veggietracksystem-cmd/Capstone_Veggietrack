import {Text,View,StyleSheet} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useAuth} from '../context/AuthContext';
import {AuthPage,AuthButton,authStyles as s} from '../components/AuthForm';
import {colors} from '../theme/appTheme';

// Icon + tint per account_status, purely visual — the status values themselves
// (and the messages they map to below) are unchanged.
const STATUS_ICONS = {
 unverified:{name:'mail-unread-outline',bg:colors.gold100,color:colors.gold700},
 pending_approval:{name:'time-outline',bg:colors.gold100,color:colors.gold700},
 declined:{name:'close-circle-outline',bg:colors.dangerSoft,color:colors.danger},
 disabled:{name:'alert-circle-outline',bg:colors.dangerSoft,color:colors.danger},
};
const DEFAULT_ICON={name:'help-circle-outline',bg:colors.leaf100,color:colors.leaf700};

export default function ApplicationStatusScreen(){
 const {user,statusError,refreshProfile,signOut}=useAuth();
 const messages={unverified:'Please check your email and confirm your account to continue.',pending_approval:'Your account is verified. Please wait for the distributor to approve your account.',declined:'Your registration was declined.',disabled:'Your account is disabled. Contact the distributor for assistance.'};
 const icon=STATUS_ICONS[user?.account_status]||DEFAULT_ICON;
 return <AuthPage title="Account status">
  <View style={[styles.iconWrap,{backgroundColor:icon.bg}]}><Ionicons name={icon.name} size={34} color={icon.color}/></View>
  <Text style={[s.note,styles.centerNote]}>{statusError || messages[user?.account_status] || 'Checking your account access.'}</Text>
  {!!user?.status_reason && <Text style={[s.note,styles.centerNote]}>{user.status_reason}</Text>}
  <AuthButton title="Refresh / Check Status" onPress={refreshProfile}/>
  <AuthButton variant="ghost" title="Logout" onPress={()=>signOut({redirectToLogin:true})}/>
 </AuthPage>;
}

const styles=StyleSheet.create({
 iconWrap:{width:84,height:84,borderRadius:42,alignItems:'center',justifyContent:'center',alignSelf:'center',marginBottom:18},
 centerNote:{textAlign:'center'},
});
