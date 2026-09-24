import { Component } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, fonts, fontSize, radius } from '../theme/appTheme';
import { tr } from '../i18n/translate';

// Keeps a tracking failure inside the tracking screen. If anything below throws
// while rendering (a malformed tracking payload, the map, ...), the user sees a
// short message and a retry button here instead of the app-wide "Restart app"
// screen. Same idea as ErrorBoundary, but local and recoverable.
export default class TrackingErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[TrackingErrorBoundary] Caught render error:', error, info);
  }

  retry = () => this.setState({ hasError: false });

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={styles.box} accessibilityRole="alert">
        <Text style={styles.title}>{tr('track.notAvailable')}</Text>
        <Text style={styles.message}>{tr('track.tryLater')}</Text>
        <TouchableOpacity style={styles.button} onPress={this.retry} activeOpacity={0.8}>
          <Text style={styles.buttonText}>{tr('track.retry')}</Text>
        </TouchableOpacity>
        {this.props.onBack ? (
          <TouchableOpacity style={styles.button} onPress={this.props.onBack} activeOpacity={0.8}>
            <Text style={styles.buttonText}>{tr('common.back')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  box: { padding: 20, borderRadius: radius.card, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  title: { fontFamily: fonts.bodyBold, fontSize: fontSize.md, color: colors.ink, textAlign: 'center' },
  message: { fontFamily: fonts.body, fontSize: fontSize.sm, color: colors.inkSoft, textAlign: 'center', marginTop: 6 },
  button: { marginTop: 14, paddingVertical: 10, paddingHorizontal: 20, borderRadius: radius.ctrl, borderWidth: 1.4, borderColor: colors.leaf700 },
  buttonText: { fontFamily: fonts.bodySemiBold, color: colors.leaf700, fontSize: fontSize.sm },
});
