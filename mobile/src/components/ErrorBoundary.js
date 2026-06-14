import { Component } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';

const PRIMARY = '#2e7d32';

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
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            The app ran into an unexpected error. You can try restarting.
          </Text>
          {this.state.error?.message ? (
            <Text style={styles.detail}>{this.state.error.message}</Text>
          ) : null}
          <TouchableOpacity style={styles.button} onPress={this.handleRestart} activeOpacity={0.7}>
            <Text style={styles.buttonText}>Restart App</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30, backgroundColor: '#f5f5f5' },
  title: { fontSize: 24, fontWeight: 'bold', color: PRIMARY, marginBottom: 12, textAlign: 'center' },
  message: { fontSize: 16, color: '#555', textAlign: 'center', marginBottom: 16 },
  detail: { fontSize: 13, color: '#999', textAlign: 'center', marginBottom: 24, fontStyle: 'italic' },
  button: { backgroundColor: PRIMARY, paddingVertical: 14, paddingHorizontal: 32, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
