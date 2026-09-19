export function authError(error) {
  if (error?.code === 'email_provider_disabled') return 'Email/password sign-in is disabled for this project. Enable the Email provider in Supabase Auth before using administrator sign-in.';
  if (error?.code === 'provider_disabled') return 'This sign-in method is currently disabled. Please contact the administrator.';
  if (['unexpected_failure', 'hook_timeout', 'hook_timeout_error'].includes(error?.code)) return 'We could not send the verification email. Please try again shortly.';
  if (['user_already_exists','identity_already_exists'].includes(error?.code)) return 'This email address cannot be used. Please use another email.';
  if (error?.status === 429 || /rate_limit|over_.*limit/.test(error?.code || '')) return 'Too many attempts. Please wait before trying again.';
  if (error?.code === 'invalid_credentials') return 'The email or password is incorrect.';
  if (error?.code === 'otp_expired') return 'The code is incorrect or expired. Please try again or request a new code.';
  if (error?.code === 'weak_password') return error.message || 'Choose a stronger password.';
  if (error?.code === 'same_password') return 'Choose a password that is different from the current password.';
  return 'The request could not be completed. Check your details and connection, then try again.';
}
