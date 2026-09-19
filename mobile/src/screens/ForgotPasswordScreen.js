import { useRef, useState } from 'react';
import { Text } from 'react-native';
import { AuthPage, AuthInput, AuthButton, authStyles as s } from '../components/AuthForm';
import { supabase, authConfigured } from '../lib/supabase';
import { authError } from '../lib/authErrors';
import * as Linking from 'expo-linking';

export default function ForgotPasswordScreen({ navigation }) {
	const [email, setEmail] = useState('');
	const [error, setError] = useState('');
	const [message, setMessage] = useState('');
	const [busy, setBusy] = useState(false);
	const lock = useRef(false);
	const submit = async () => {
		if (lock.current) return;
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter a valid email address.'); return; }
		lock.current = true; setBusy(true); setError('');
		try {
			const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
				redirectTo: Linking.createURL('reset-password'),
			});
			if (resetError) throw resetError;
			setMessage('Check your email for a password reset link. Open it on this device to choose a new password.');
		} catch (resetError) { setError(authError(resetError)); }
		finally { lock.current = false; setBusy(false); }
	};
	return <AuthPage title="Reset password">
		{!authConfigured && <Text style={s.error}>Supabase configuration is required.</Text>}
		<AuthInput placeholder="Email" accessibilityLabel="Email" keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} editable={!busy} />
		<AuthButton title="Send reset link" disabled={busy || !authConfigured} onPress={submit} />
		{!!message && <Text style={s.note}>{message}</Text>}
		{!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
		<AuthButton variant="ghost" title="Back" onPress={() => navigation.goBack()} />
	</AuthPage>;
}
