import { rf } from '../lib/responsive';
import { View, Text, TouchableOpacity, StyleSheet, Image, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from '../i18n/useTranslation';
import { colors, control, fontSize, fonts, radius } from '../theme/appTheme';

// First screen for unauthenticated users (Issue 13). Logged-in users never reach
// this because App.js renders the role dashboard stack instead of the auth stack.
export default function LandingScreen({ navigation }) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const logoSize = Math.min(Math.max(width - 60, 0), 260);
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <Image
          source={require('../../assets/new_logo.png')}
          style={[styles.logo, { width: logoSize, height: logoSize }]}
          resizeMode="contain"
          accessibilityLabel={t('landing.appName')}
        />
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
  logo: { marginBottom: 12 },
  tagline: { fontFamily: fonts.body, fontSize: rf(fontSize.lg), color: colors.inkSoft, textAlign: 'center' },
  actions: { paddingHorizontal: 30, paddingBottom: 40, gap: 8 },
  primaryBtn: { backgroundColor: colors.leaf700, paddingVertical: 16, borderRadius: radius.ctrl, alignItems: 'center', justifyContent: 'center', minHeight: control.height },
  primaryBtnText: { color: '#fff', fontFamily: fonts.bodyBold, fontSize: rf(fontSize.xl), textAlign: 'center' },
  link: { textAlign: 'center', marginTop: 16, color: colors.leaf700, fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md) },
});
