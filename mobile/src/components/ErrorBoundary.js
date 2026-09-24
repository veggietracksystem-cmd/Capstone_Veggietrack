import { rf } from '../lib/responsive';
import { Component } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { tr } from '../i18n/translate';

const PRIMARY = '#1E4E09';

// Class component because only class components can be error boundaries
// (componentDidCatch / getDerivedStateFromError have no hooks equivalent).
// Catches render-time errors in the tree below it and shows a fallback UI
// instead of a blank/white crash screen.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Surfaces in the Metro/console log for debugging.
    console.error('[ErrorBoundary] Caught render error:', error, info);
  }

  handleRestart = () => {
    // On web we can do a true reload. On native there's no built-in
    // "restart app" without expo-updates, so we reset the boundary state
    // which re-mounts the children (a fresh render attempt).
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.reload();
      return;
    }
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>{tr('cmp.boundaryTitle')}</Text>
          <Text style={styles.message}>
            {tr('cmp.boundaryMsg')}
          </Text>
          {/* The raw error stays in the console for developers; showing it
              here only puts developer text in front of a user. */}
          <TouchableOpacity style={styles.button} onPress={this.handleRestart} activeOpacity={0.7}>
            <Text style={styles.buttonText}>{tr('cmp.restart')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30, backgroundColor: '#FFFFFF' },
  title: { fontSize: rf(24), fontWeight: 'bold', color: PRIMARY, marginBottom: 12, textAlign: 'center' },
  message: { fontSize: rf(16), color: '#555', textAlign: 'center', marginBottom: 16 },
  button: { backgroundColor: PRIMARY, paddingVertical: 14, paddingHorizontal: 32, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: rf(16), fontWeight: '600' },
});
