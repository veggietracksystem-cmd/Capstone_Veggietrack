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
