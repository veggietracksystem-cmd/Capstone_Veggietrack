const {normalizePhone,isValidPhone,PHONE_HINT}=require('./phone');
function validateNewPhone(current,value){
 if(!isValidPhone(value))throw new Error(PHONE_HINT);
 const phone=normalizePhone(value);
 if(phone===normalizePhone(current))throw new Error('This is already your registered mobile number.');
 return phone;
}
async function requestPhoneChange(auth,current,value){
 const phone=validateNewPhone(current,value);
 const {error}=await auth.updateUser({phone});
 if(error)throw error;
 return phone;
}
async function verifyPhoneChange(auth,id,phone,token){
 const verified=await auth.verifyOtp({phone:normalizePhone(phone),token,type:'phone_change'});
 if(verified.error)throw verified.error;
 const {data,error}=await auth.getUser();
 if(error)throw error;
 if(data.user?.id!==id || normalizePhone(data.user?.phone)!==normalizePhone(phone))throw new Error('Identity update could not be confirmed.');
 return data.user;
}
module.exports={validateNewPhone,requestPhoneChange,verifyPhoneChange};
