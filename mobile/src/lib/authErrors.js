export function authError(error) {
  if (error?.code === 'email_provider_disabled') return 'Signing in with an email address isn’t available right now. Please try again later.';
  if (error?.code === 'provider_disabled') return 'This way of signing in isn’t available right now. Please contact the distributor.';
  if (['unexpected_failure', 'hook_timeout', 'hook_timeout_error'].includes(error?.code)) return 'We couldn’t send the email. Please try again in a moment.';
  if (['user_already_exists','identity_already_exists'].includes(error?.code)) return 'This email address is already in use. Please use a different one.';
  if (error?.status === 429 || /rate_limit|over_.*limit/.test(error?.code || '')) return 'Too many tries. Please wait a moment and try again.';
  if (error?.code === 'invalid_credentials') return 'We couldn’t sign you in. Please check your details and try again.';
  if (error?.code === 'otp_expired') return 'That code is wrong or has expired. Please try again or ask for a new code.';
  if (error?.code === 'weak_password') return 'Please choose a stronger password.';
  if (error?.code === 'same_password') return 'Please choose a password that is different from your current one.';
  return 'Something went wrong. Please check your details and your internet connection, then try again.';
}
