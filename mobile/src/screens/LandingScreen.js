import { rf } from '../lib/responsive';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from '../i18n/useTranslation';
import { colors, fonts, fontSize, radius } from '../theme/appTheme';
import { BrandMark } from '../components/AuthForm';

// First screen for unauthenticated users (Issue 13). Logged-in users never reach
// this because App.js renders the role dashboard stack instead of the auth stack.
export default function LandingScreen({ navigation }) {
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <BrandMark size={88} />
        <Text style={styles.appName}>{t('landing.appName')}</Text>
        <Text style={styles.tagline}>{t('landing.tagline')}</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => navigation.navigate('Login')}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>{t('landing.getStarted')}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('Register')} activeOpacity={0.7}>
          <Text style={styles.link}>{t('landing.createAccount')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen, justifyContent: 'space-between' },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  appName: { fontFamily: fonts.headingBold, fontSize: rf(fontSize.h1), color: colors.leaf700, marginBottom: 8 },
  tagline: { fontFamily: fonts.body, fontSize: rf(fontSize.lg), color: colors.inkSoft, textAlign: 'center' },
  actions: { paddingHorizontal: 30, paddingBottom: 40, gap: 8 },
  primaryBtn: { backgroundColor: colors.leaf700, paddingVertical: 16, borderRadius: radius.ctrl, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontFamily: fonts.bodyBold, fontSize: rf(fontSize.xl) },
  link: { textAlign: 'center', marginTop: 16, color: colors.leaf700, fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md) },
});
