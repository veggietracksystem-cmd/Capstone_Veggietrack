import { rf } from '../lib/responsive';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, Animated,
  KeyboardAvoidingView, ScrollView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
 *  - cancelLabel  / onCancel:   outline footer button for a real second choice
 *                  (e.g. "Cancel" beside "Save"); dismiss-only callers should
 *                  just pass onCancel and skip cancelLabel - the header's X
 *                  already closes the modal, so a plain "Close" footer button
 *                  would be redundant and is left off.
 *  - busy:         disables buttons + shows the confirm button as disabled
 *  - confirmDisabled: independently disable the confirm button
 *  - compactActions: smaller, centred buttons (read-only detail views)
 *  - danger:       red confirm button, for destructive actions (e.g. Log Out)
 *  - hideCloseIcon: hide the header's X (Cancel/Confirm are the only way out)
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
  compactActions = false,
  danger = false,
  hideCloseIcon = false,
}) {
  const { t } = useTranslation();
  // A cancelLabel that just says "close" (explicitly or by omission) means
  // there's no real second choice - the header X covers that, so no
  // redundant footer button. An explicit different label (e.g. "Cancel")
  // is a genuine second choice and keeps its footer button.
  const closeWords = [t('common.close'), t('notifications.close')];
  const showCancelButton = !!onCancel && !closeWords.includes(cancelLabel ?? t('common.close'));
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
            {(title || onCancel) ? (
              <View style={styles.head}>
                <Text style={styles.title} numberOfLines={1}>{title}</Text>
                {(onCancel && !hideCloseIcon) ? (
                  <TouchableOpacity
                    style={styles.closeBtn}
                    onPress={onCancel}
                    disabled={busy}
                    activeOpacity={0.7}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.close')}
                  >
                    <Ionicons name="close" size={rf(18)} color={colors.soil800} />
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
            <ScrollView
              style={styles.bodyScroll}
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>

            {(showCancelButton || onConfirm) ? (
              <View style={[styles.actions, compactActions && styles.actionsCompact]}>
                {showCancelButton ? (
                  <TouchableOpacity
                    style={[styles.btn, styles.btnOutline, compactActions && styles.btnCompact, busy && styles.btnDisabled]}
                    onPress={onCancel}
                    disabled={busy}
                    hitSlop={compactActions ? { top: 6, bottom: 6, left: 6, right: 6 } : undefined}
                  >
                    <Text style={[styles.btnOutlineText, compactActions && styles.btnTextCompact]}>{cancelLabel}</Text>
                  </TouchableOpacity>
                ) : null}
                {onConfirm ? (
                  <TouchableOpacity
                    style={[styles.btn, styles.btnPrimary, danger && styles.btnDanger, compactActions && styles.btnCompact, (busy || confirmDisabled) && styles.btnDisabled]}
                    onPress={onConfirm}
                    disabled={busy || confirmDisabled}
                  >
                    <Text style={styles.btnPrimaryText}>{confirmLabel || t('common.confirm')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
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
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 },
  title: { flex: 1, fontFamily: fonts.heading, fontSize: rf(18), color: colors.ink },
  // Same small rounded outlined close button every other modal uses.
  closeBtn: {
    width: 38, height: 38, borderRadius: radius.ctrl, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  bodyScroll: { flexGrow: 0, flexShrink: 1 },
  body: { marginBottom: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: { flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: 8, paddingVertical: 13, borderRadius: radius.ctrl, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: PRIMARY },
  btnDanger: { backgroundColor: colors.danger },
  btnPrimaryText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(15), textAlign: 'center' },
  btnOutline: { borderWidth: 1.5, borderColor: PRIMARY },
  btnOutlineText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: rf(15), textAlign: 'center' },
  btnDisabled: { opacity: 0.5 },
  actionsCompact: { justifyContent: 'center' },
  btnCompact: { flex: 0, minHeight: 38, paddingVertical: 8, paddingHorizontal: 28 },
  btnTextCompact: { fontSize: rf(14) },
});
