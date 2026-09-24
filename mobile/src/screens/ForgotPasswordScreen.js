import { useRef, useState } from 'react';
import { Text } from 'react-native';
import { AuthPage, AuthInput, AuthButton, authStyles as s } from '../components/AuthForm';
import { supabase, authConfigured } from '../lib/supabase';
import { authError } from '../lib/authErrors';
import * as Linking from 'expo-linking';
import { useTranslation } from '../i18n/useTranslation';

// Reached both from Login (email typed by hand) and from Edit Profile, which
// already knows the signed-in address and passes it through as a param.
export default function ForgotPasswordScreen({ navigation, route }) {
	const { t } = useTranslation();
	const [email, setEmail] = useState(route?.params?.email || '');
	const [error, setError] = useState('');
	const [message, setMessage] = useState('');
	const [busy, setBusy] = useState(false);
	const lock = useRef(false);
	const submit = async () => {
		if (lock.current) return;
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError(t('authx.invalidEmail')); return; }
		lock.current = true; setBusy(true); setError('');
		try {
			const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
				redirectTo: Linking.createURL('reset-password'),
			});
			if (resetError) throw resetError;
			setMessage(t('authx.linkSent'));
		} catch (resetError) { setError(authError(resetError)); }
		finally { lock.current = false; setBusy(false); }
	};
	return <AuthPage title={t('authx.resetTitle')}>
		{!authConfigured && <Text style={s.error}>{t('authx.unavailable')}</Text>}
		<AuthInput placeholder={t('authx.email')} accessibilityLabel={t('authx.email')} keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} editable={!busy} />
		<AuthButton title={t('authx.sendLink')} disabled={busy || !authConfigured} onPress={submit} />
		{!!message && <Text style={s.note}>{message}</Text>}
		{!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
		<AuthButton variant="ghost" title={t('common.back')} onPress={() => navigation.goBack()} />
	</AuthPage>;
}
