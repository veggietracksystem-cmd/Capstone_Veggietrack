import {Text} from 'react-native';
import {useAuth} from '../context/AuthContext';
import {AuthPage,AuthButton,authStyles as s} from '../components/AuthForm';
import PhoneOtpScreen from './PhoneOtpScreen';
export default function ApplicationStatusScreen(){
 const {user,statusError,refreshProfile,signOut}=useAuth();
 if(user?.account_status==='unverified')return <PhoneOtpScreen route={{name:'PhoneOtp',params:{phone:user.phone}}} navigation={{navigate:()=>signOut({redirectToLogin:true})}}/>;
 const messages={pending_approval:'Your mobile number is verified. Please wait for the distributor to approve your account.',declined:'Your registration was declined.',disabled:'Your account is disabled. Contact the distributor for assistance.'};
 return <AuthPage title="Account status"><Text style={s.note}>{statusError || messages[user?.account_status] || 'Checking your account access.'}</Text>{!!user?.status_reason && <Text style={s.note}>{user.status_reason}</Text>}<AuthButton title="Refresh / Check Status" onPress={refreshProfile}/><AuthButton title="Logout" onPress={()=>signOut({redirectToLogin:true})}/></AuthPage>;
}
