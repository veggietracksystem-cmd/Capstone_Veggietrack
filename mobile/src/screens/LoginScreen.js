import { useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AuthPage, AuthInput, AuthButton, authStyles as s } from '../components/AuthForm';
import PasswordInput from '../components/PasswordInput';
import { authConfigured } from '../lib/supabase';
import { authError } from '../lib/authErrors';
import { useAuth } from '../context/AuthContext';
import { colors, control, fonts, fontSize } from '../theme/appTheme';
import { rf } from '../lib/responsive';

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
	return <AuthPage title="Log in" titleStyle={styles.title} logoSource={require('../../assets/new_logo.png')} logoSize={rf(128)}>
		{!authConfigured && <Text style={s.error}>Signing in isn’t available right now. Please try again later.</Text>}
		<AuthInput placeholder="Email" accessibilityLabel="Email" keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} editable={!busy} />
		<PasswordInput style={s.input} placeholder="Password" accessibilityLabel="Password" value={password} onChangeText={setPassword} editable={!busy} />
		<View style={styles.continueGap} />
		<AuthButton title="Continue" disabled={busy || !authConfigured} onPress={login} />
		<AuthButton variant="ghost" title="Forgot password?" onPress={() => navigation.navigate('ForgotPassword')} />
		<TouchableOpacity
			style={styles.signupRow}
			onPress={() => navigation.navigate('Register')}
			accessibilityRole="link"
			accessibilityLabel="Don’t have an account? Create account"
		>
			<Text style={styles.signupText}>
				Don’t have an account? <Text style={styles.signupLink}>Create account</Text>
			</Text>
		</TouchableOpacity>
		{!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
	</AuthPage>;
}

const styles = StyleSheet.create({
	// Centred, a step lighter than the default auth title, with even gaps
	// logo → title → inputs.
	title: { fontSize: rf(fontSize.title + 2), marginTop: 4, marginBottom: 24 },
	// Small extra gap between the last input and Continue.
	continueGap: { height: 4 },
	signupRow: { alignSelf: 'center', minHeight: control.minTouch, justifyContent: 'center', paddingHorizontal: 8, marginTop: 20 },
	signupText: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.inkSoft, textAlign: 'center', textDecorationLine: 'underline' },
	signupLink: { fontFamily: fonts.bodySemiBold, color: colors.leaf700, textDecorationLine: 'underline' },
});
