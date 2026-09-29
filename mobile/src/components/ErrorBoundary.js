import { rf } from '../lib/responsive';
import { Component } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { tr } from '../i18n/translate';

const PRIMARY = '#1E4E09';

// Catches render errors below it and shows a fallback screen instead of a blank
// crash. Error boundaries must be class components.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught render error:', error, info);
  }

  handleRestart = () => {
    // Web can reload the page; on native, resetting the state re-mounts the children.
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
          {/* The raw error is logged to the console rather than shown to the user. */}
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
