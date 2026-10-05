import { tr } from '../i18n/translate';

export function authError(error) {
  if (error?.code === 'email_provider_disabled') return tr('authErr.emailProviderDisabled');
  if (error?.code === 'provider_disabled') return tr('authErr.providerDisabled');
  if (['unexpected_failure', 'hook_timeout', 'hook_timeout_error'].includes(error?.code)) return tr('authErr.emailFailed');
  if (['user_already_exists','identity_already_exists'].includes(error?.code)) return tr('authErr.emailInUse');
  if (error?.status === 429 || /rate_limit|over_.*limit/.test(error?.code || '')) return tr('authErr.tooManyTries');
  if (error?.code === 'invalid_credentials') return tr('authErr.invalidCredentials');
  if (error?.code === 'otp_expired') return tr('authErr.otpExpired');
  if (error?.code === 'weak_password') return tr('authErr.weakPassword');
  if (error?.code === 'same_password') return tr('authErr.samePassword');
  return tr('authErr.generic');
}

// Forgot Password. Supabase answers a code request for an email with no account
// (shouldCreateUser: false) with otp_disabled / "Signups not allowed for otp".
export function recoveryError(error) {
  if (['otp_disabled', 'user_not_found'].includes(error?.code) || /signups not allowed for otp|user not found/i.test(error?.message || '')) {
    return tr('authx.accountNotFound');
  }
  if (error?.code === 'otp_expired' || /token has expired or is invalid/i.test(error?.message || '')) return tr('authx.codeInvalid');
  if (error?.status === 429 || /rate_limit|over_.*limit/.test(error?.code || '')) return tr('authErr.tooManyTries');
  if (['weak_password', 'same_password', 'email_provider_disabled', 'provider_disabled'].includes(error?.code)) return authError(error);
  return tr('authx.resetFailed');
}
