import { useEffect, useRef } from 'react';
import {
  Modal, View, Text, TouchableOpacity, Animated, StyleSheet,
} from 'react-native';
import { useTranslation } from '../i18n/useTranslation';

const PRIMARY = '#2e7d32';

/**
 * Reusable themed modal (Issue 1): dimmed backdrop, centered rounded card, green
 * theme, and a subtle scale/fade-in animation. Replaces ad-hoc modals so dialogs
 * look consistent across the app.
 *
 * Props:
 *  - visible:      show/hide
 *  - title:        bold green heading
 *  - children:     body content
 *  - confirmLabel / onConfirm:  primary green button (omit to hide)
 *  - cancelLabel  / onCancel:   outline button (also fired on backdrop/back press)
 *  - busy:         disables buttons + shows the confirm button as disabled
 *  - confirmDisabled: independently disable the confirm button
 */
export default function CustomModal({
  visible,
  title,
  children,
  confirmLabel,
  onConfirm,
  cancelLabel,
  onCancel,
  busy = false,
  confirmDisabled = false,
}) {
  const { t } = useTranslation();
  const resolvedCancelLabel = cancelLabel ?? t('common.close');
  const scale = useRef(new Animated.Value(0.9)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 7 }),
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    } else {
      scale.setValue(0.9);
      opacity.setValue(0);
    }
  }, [visible, scale, opacity]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? undefined : onCancel}>
      <Animated.View style={[styles.backdrop, { opacity }]}>
        {/* Tapping the backdrop dismisses (unless busy). */}
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={busy ? undefined : onCancel} />

        <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          <View style={styles.body}>{children}</View>

          <View style={styles.actions}>
            {onCancel ? (
              <TouchableOpacity
                style={[styles.btn, styles.btnOutline, busy && styles.btnDisabled]}
                onPress={onCancel}
                disabled={busy}
              >
                <Text style={styles.btnOutlineText}>{resolvedCancelLabel}</Text>
              </TouchableOpacity>
            ) : null}
            {onConfirm ? (
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, (busy || confirmDisabled) && styles.btnDisabled]}
                onPress={onConfirm}
                disabled={busy || confirmDisabled}
              >
                <Text style={styles.btnPrimaryText}>{confirmLabel || t('common.confirm')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, backgroundColor: '#fff', borderRadius: 16, padding: 22, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  title: { fontSize: 19, fontWeight: '700', color: PRIMARY, marginBottom: 12 },
  body: { marginBottom: 6 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  btn: { flex: 1, paddingVertical: 13, borderRadius: 10, alignItems: 'center' },
  btnPrimary: { backgroundColor: PRIMARY },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnOutline: { borderWidth: 1.5, borderColor: PRIMARY },
  btnOutlineText: { color: PRIMARY, fontWeight: '600', fontSize: 15 },
  btnDisabled: { opacity: 0.5 },
});
