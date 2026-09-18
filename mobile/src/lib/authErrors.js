export function authError(error) {
  if (error?.code === 'phone_provider_disabled') return 'Phone sign-in is currently disabled. Please contact the administrator to enable it.';
  if (error?.code === 'email_provider_disabled') return 'Email/password sign-in is disabled for this project. Enable the Email provider in Supabase Auth before using administrator sign-in.';
  if (error?.code === 'provider_disabled') return 'This sign-in method is currently disabled. Please contact the administrator.';
  if (['unexpected_failure', 'hook_timeout', 'hook_timeout_error', 'sms_send_failed'].includes(error?.code)) return 'We could not send the verification SMS. Please try again shortly. If it continues, the administrator must check the Supabase Send SMS Hook and Render service.';
  if (['user_already_exists','phone_exists','identity_already_exists'].includes(error?.code)) return 'This mobile number cannot be used. Please use another number.';
  if (error?.status === 429 || /rate_limit|over_.*limit/.test(error?.code || '')) return 'Too many attempts. Please wait before trying again.';
  if (error?.code === 'invalid_credentials') return 'The email/mobile number or password is incorrect.';
  if (error?.code === 'otp_expired') return 'The code is incorrect or expired. Please try again or request a new code.';
  return 'The request could not be completed. Check your details and connection, then try again.';
}
