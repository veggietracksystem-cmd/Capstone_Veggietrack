import { rf } from '../lib/responsive';
import { Text, TextInput, TouchableOpacity, ScrollView, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, fontSize, radius } from '../theme/appTheme';
export const authStyles = StyleSheet.create({
 page:{flex:1,backgroundColor:colors.bgScreen},content:{padding:24,width:'100%',maxWidth:480,alignSelf:'center',flexGrow:1,justifyContent:'center'},
 title:{fontFamily:fonts.headingBold,fontSize:rf(fontSize.h1),color:colors.leaf700,marginBottom:16,textAlign:'center'},
 note:{fontFamily:fonts.body,fontSize:rf(fontSize.md),color:colors.inkSoft,marginBottom:16},
 input:{backgroundColor:colors.card,borderWidth:1,borderColor:colors.border,borderRadius:radius.ctrl,padding:14,marginBottom:16,fontFamily:fonts.body,fontSize:rf(fontSize.lg),color:colors.ink},
 // Button variants: primary (solid, default) / outline (bordered) / ghost (text-only, lowest emphasis).
 button:{backgroundColor:colors.leaf700,padding:16,borderRadius:radius.ctrl,alignItems:'center',marginVertical:6},
 buttonOutline:{backgroundColor:'transparent',borderWidth:1.5,borderColor:colors.leaf700,padding:16,borderRadius:radius.ctrl,alignItems:'center',marginVertical:6},
 buttonGhost:{backgroundColor:'transparent',paddingVertical:10,alignItems:'center',marginVertical:2},
 white:{color:'#fff',fontFamily:fonts.bodySemiBold,fontSize:rf(fontSize.lg)},
 textOutline:{color:colors.leaf700,fontFamily:fonts.bodySemiBold,fontSize:rf(fontSize.lg)},
 textGhost:{color:colors.leaf700,fontFamily:fonts.bodyMedium,fontSize:rf(fontSize.md)},
 error:{fontFamily:fonts.bodyMedium,fontSize:rf(fontSize.md),color:colors.danger,marginVertical:12},
 link:{textAlign:'center',padding:14,fontFamily:fonts.bodySemiBold,fontSize:rf(fontSize.md),color:colors.leaf700},
 adminLoginRow:{alignItems:'flex-end',marginBottom:12},adminLoginButton:{flexDirection:'row',alignItems:'center',gap:6,paddingVertical:6,paddingHorizontal:2},
 adminLoginText:{color:colors.leaf700,fontFamily:fonts.bodySemiBold,fontSize:rf(fontSize.sm)},
 brandMark:{backgroundColor:colors.leaf700,alignItems:'center',justifyContent:'center',alignSelf:'center',marginBottom:16},
});
// Solid green circle + leaf glyph. Shared brand mark used on Landing (large) and
// AuthPage (small, opt-in via the `logo` prop) so the two screens feel related.
export function BrandMark({ size = 56 }) {
 return <View style={[authStyles.brandMark,{width:size,height:size,borderRadius:size/2}]}><Ionicons name="leaf" size={size*0.5} color="#fff"/></View>;
}
export function AuthPage({title,children,logo}) { return <SafeAreaView style={authStyles.page}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={authStyles.content}>{logo && <BrandMark/>}<Text style={authStyles.title}>{title}</Text>{children}</ScrollView></SafeAreaView>; }
const AUTH_BUTTON_VARIANTS = {
 primary:[authStyles.button,authStyles.white],
 outline:[authStyles.buttonOutline,authStyles.textOutline],
 ghost:[authStyles.buttonGhost,authStyles.textGhost],
};
export function AuthButton({title,onPress,disabled,variant='primary'}) {
 const [btnStyle,textStyle]=AUTH_BUTTON_VARIANTS[variant]||AUTH_BUTTON_VARIANTS.primary;
 return <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={onPress} style={[btnStyle,disabled && {opacity:.5}]}><Text style={textStyle}>{title}</Text></TouchableOpacity>;
}
export function AuthInput(props) { return <TextInput style={authStyles.input} placeholderTextColor={colors.inkFaint} autoCapitalize="none" {...props}/>; }
