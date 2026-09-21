import { useRef, useState } from 'react';
import { Text } from 'react-native';
import { AuthPage, AuthInput, AuthButton, authStyles as s } from '../components/AuthForm';
import PasswordInput from '../components/PasswordInput';
import { authConfigured } from '../lib/supabase';
import { authError } from '../lib/authErrors';
import { useAuth } from '../context/AuthContext';

export default function LoginScreen({ navigation }) {
	const { signInWithEmail } = useAuth();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const lock = useRef(false);
	const login = async () => {
		if (lock.current) return;
		setError('');
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Please enter a valid email address.'); return; }
		if (!password) { setError('Please enter your password.'); return; }
		lock.current = true; setBusy(true);
		try {
			await signInWithEmail(email.trim(), password);
			setPassword('');
			navigation.navigate('VerifyEmail', { email: email.trim(), purpose: 'login' });
		}
		catch (authFailure) { setError(authError(authFailure)); }
		finally { lock.current = false; setBusy(false); }
	};
	return <AuthPage title="Sign in">
		{!authConfigured && <Text style={s.error}>Signing in isn’t available right now. Please try again later.</Text>}
		<AuthInput placeholder="Email" accessibilityLabel="Email" keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} editable={!busy} />
		<PasswordInput style={s.input} placeholder="Password" accessibilityLabel="Password" value={password} onChangeText={setPassword} editable={!busy} />
		<AuthButton title="Continue" disabled={busy || !authConfigured} onPress={login} />
		<Text style={s.note}>We’ll email you a code to confirm it’s you.</Text>
		<AuthButton variant="outline" title="Create account" onPress={() => navigation.navigate('Register')} />
		<AuthButton variant="ghost" title="Forgot password" onPress={() => navigation.navigate('ForgotPassword')} />
		{!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
	</AuthPage>;
}
