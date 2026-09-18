import { rf } from '../lib/responsive';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, Animated,
  KeyboardAvoidingView, ScrollView, Platform,
} from 'react-native';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { useSharedModalMotion } from '../lib/motion';

const PRIMARY = colors.leaf700;

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
  const { backdropStyle, cardStyle } = useSharedModalMotion(visible);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={busy ? undefined : onCancel}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          {/* Tapping the backdrop dismisses (unless busy). */}
          <TouchableOpacity style={[StyleSheet.absoluteFill, styles.backdropDismiss]} activeOpacity={1} onPress={busy ? undefined : onCancel} />

          <Animated.View style={[styles.card, cardStyle]}>
            {title ? <Text style={styles.title}>{title}</Text> : null}
            <ScrollView
              style={styles.bodyScroll}
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>

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
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  kav: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(20,17,16,0.42)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  backdropDismiss: { pointerEvents: 'auto' },
  card: { width: '100%', maxWidth: 380, maxHeight: '90%', backgroundColor: colors.bgScreen, borderRadius: radius.card, padding: 22, ...shadowCard },
  title: { fontFamily: fonts.heading, fontSize: rf(18), color: colors.ink, marginBottom: 12 },
  bodyScroll: { flexGrow: 0, flexShrink: 1 },
  body: { marginBottom: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: { flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: 8, paddingVertical: 13, borderRadius: radius.ctrl, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: PRIMARY },
  btnPrimaryText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(15) },
  btnOutline: { borderWidth: 1.5, borderColor: PRIMARY },
  btnOutlineText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: rf(15) },
  btnDisabled: { opacity: 0.5 },
});
