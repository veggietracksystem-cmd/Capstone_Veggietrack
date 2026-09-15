import { Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
export const authStyles = StyleSheet.create({
 page:{flex:1,backgroundColor:'#F7F9F4'},content:{padding:24,width:'100%',maxWidth:480,alignSelf:'center',flexGrow:1,justifyContent:'center'},
 title:{fontFamily:'Poppins_700Bold',fontSize:26,color:'#1E4E09',marginBottom:16},note:{color:'#5E665A',marginBottom:16},
 input:{backgroundColor:'#fff',borderWidth:1,borderColor:'#CDD7C6',borderRadius:10,padding:14,marginBottom:16,fontSize:16},
 button:{backgroundColor:'#1E4E09',padding:16,borderRadius:10,alignItems:'center',marginVertical:6},white:{color:'#fff',fontFamily:'Poppins_600SemiBold'},
 error:{color:'#A32621',marginVertical:12},link:{textAlign:'center',padding:14,color:'#1E4E09'},
});
export function AuthPage({title,children}) { return <SafeAreaView style={authStyles.page}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={authStyles.content}><Text style={authStyles.title}>{title}</Text>{children}</ScrollView></SafeAreaView>; }
export function AuthButton({title,onPress,disabled}) { return <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={onPress} style={[authStyles.button,disabled && {opacity:.5}]}><Text style={authStyles.white}>{title}</Text></TouchableOpacity>; }
export function AuthInput(props) { return <TextInput style={authStyles.input} autoCapitalize="none" {...props}/>; }
