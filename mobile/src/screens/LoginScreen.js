import { useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AuthPage, AuthInput, AuthButton, authStyles as s } from '../components/AuthForm';
import PasswordInput from '../components/PasswordInput';
import { authConfigured, setKeepSignedIn } from '../lib/supabase';
import Checkbox from '../components/Checkbox';
import { authError } from '../lib/authErrors';
import { useAuth } from '../context/AuthContext';
import { colors, control, fonts, fontSize } from '../theme/appTheme';
import { rf } from '../lib/responsive';
import { useTranslation } from '../i18n/useTranslation';

export default function LoginScreen({ navigation }) {
	const { t } = useTranslation();
	const { signInWithEmail } = useAuth();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [keepSignedIn, setKeep] = useState(false); // off unless the user ticks it
	const lock = useRef(false);
	const login = async () => {
		if (lock.current) return;
		setError('');
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError(t('authx.invalidEmail')); return; }
		if (!password) { setError(t('authx.enterPassword')); return; }
		lock.current = true; setBusy(true);
		try {
			await setKeepSignedIn(keepSignedIn);
			await signInWithEmail(email.trim(), password);
			setPassword('');
			navigation.navigate('VerifyEmail', { email: email.trim(), purpose: 'login' });
		}
		catch (authFailure) { setError(authError(authFailure)); }
		finally { lock.current = false; setBusy(false); }
	};
	return <AuthPage title={t('authx.logIn')} titleStyle={styles.title} logoSource={require('../../assets/new_logo.png')} logoSize={rf(128)}>
		{!authConfigured && <Text style={s.error}>{t('authx.signInUnavailable')}</Text>}
		<AuthInput placeholder={t('authx.email')} accessibilityLabel={t('authx.email')} keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} editable={!busy} />
		<PasswordInput style={s.input} placeholder={t('authx.password')} accessibilityLabel={t('authx.password')} value={password} onChangeText={setPassword} editable={!busy} />
		<View style={styles.continueGap} />
		<AuthButton title={t('authx.continue')} disabled={busy || !authConfigured} onPress={login} />
		<View style={styles.optionsRow}>
			<TouchableOpacity style={styles.keepRow} onPress={() => setKeep(v => !v)} disabled={busy} activeOpacity={0.7} accessibilityRole="checkbox" accessibilityState={{ checked: keepSignedIn }}>
				<Checkbox checked={keepSignedIn} />
				<Text style={styles.keepText}>{t('keepx.keepSignedIn')}</Text>
			</TouchableOpacity>
			<TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')} hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }} accessibilityRole="button">
				<Text style={styles.forgotText}>{t('authx.forgot')}</Text>
			</TouchableOpacity>
		</View>
		<TouchableOpacity
			style={styles.signupRow}
			onPress={() => navigation.navigate('Register')}
			accessibilityRole="link"
			accessibilityLabel={`${t('authx.noAccount')} ${t('authx.createAccount')}`}
		>
			<Text style={styles.signupText}>
				{t('authx.noAccount')} <Text style={styles.signupLink}>{t('authx.createAccount')}</Text>
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
	// Keep me signed in (left) and Forgot password? (right) share one row; the left label shrinks before the link does.
	optionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 4, marginBottom: 4, minHeight: control.minTouch },
	keepRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
	keepText: { flexShrink: 1, fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft },
	forgotText: { fontFamily: fonts.bodyMedium, fontSize: rf(fontSize.sm), color: colors.leaf700 },
	signupRow: { alignSelf: 'center', minHeight: control.minTouch, justifyContent: 'center', paddingHorizontal: 8, marginTop: 20 },
	signupText: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.inkSoft, textAlign: 'center' },
	signupLink: { fontFamily: fonts.bodySemiBold, color: colors.leaf700, textDecorationLine: 'underline' },
});
