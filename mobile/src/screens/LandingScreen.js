import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const PRIMARY = '#2e7d32';

// First screen for unauthenticated users (Issue 13). Logged-in users never reach
// this because App.js renders the role dashboard stack instead of the auth stack.
export default function LandingScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.logo}>🥬</Text>
        <Text style={styles.appName}>VeggieTrack</Text>
        <Text style={styles.tagline}>Fresh produce, tracked from farm to store.</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => navigation.navigate('Login')}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Get Started</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('Register')} activeOpacity={0.7}>
          <Text style={styles.link}>New here? Create an account</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', justifyContent: 'space-between' },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  logo: { fontSize: 80, marginBottom: 12 },
  appName: { fontSize: 40, fontWeight: 'bold', color: PRIMARY, marginBottom: 8 },
  tagline: { fontSize: 16, color: '#555', textAlign: 'center' },
  actions: { paddingHorizontal: 30, paddingBottom: 40, gap: 8 },
  primaryBtn: { backgroundColor: PRIMARY, paddingVertical: 16, borderRadius: 10, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  link: { textAlign: 'center', marginTop: 16, color: PRIMARY, fontSize: 14, fontWeight: '600' },
});
