import { rf } from '../lib/responsive';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, Animated,
  KeyboardAvoidingView, ScrollView, Platform,
} from 'react-native';
import ModalCloseButton from './ui/ModalCloseButton';
import { colors, fonts, radius, shadowCard, dangerButton, dangerButtonText } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { useSharedModalMotion } from '../lib/motion';

const PRIMARY = colors.leaf700;

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
  // A cancel label that only means "close" is omitted; the header X covers it.
  const closeWords = [t('common.close'), t('notifications.close')];
  const showCancelButton = !!onCancel && !closeWords.includes(cancelLabel ?? t('common.close'));
  const { backdropStyle, cardStyle } = useSharedModalMotion(visible);
  const singleAction = showCancelButton !== !!onConfirm;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={busy ? undefined : onCancel}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <TouchableOpacity style={[StyleSheet.absoluteFill, styles.backdropDismiss]} activeOpacity={1} onPress={busy ? undefined : onCancel} />

          <Animated.View style={[styles.card, cardStyle]}>
            {(title || onCancel) ? (
              <View style={styles.head}>
                <Text style={styles.title} numberOfLines={1}>{title}</Text>
                {(onCancel && !hideCloseIcon) ? (
                  <ModalCloseButton onPress={onCancel} disabled={busy} />
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
              <View style={[styles.actions, (compactActions || singleAction) && styles.actionsCompact]}>
                {showCancelButton ? (
                  <TouchableOpacity
                    style={[styles.btn, styles.btnOutline, singleAction && styles.btnSingle, compactActions && styles.btnCompact, busy && styles.btnDisabled]}
                    onPress={onCancel}
                    disabled={busy}
                    hitSlop={compactActions ? { top: 6, bottom: 6, left: 6, right: 6 } : undefined}
                  >
                    <Text style={[styles.btnOutlineText, compactActions && styles.btnTextCompact]}>{cancelLabel}</Text>
                  </TouchableOpacity>
                ) : null}
                {onConfirm ? (
                  <TouchableOpacity
                    style={[styles.btn, styles.btnPrimary, danger && styles.btnDanger, singleAction && styles.btnSingle, compactActions && styles.btnCompact, (busy || confirmDisabled) && styles.btnDisabled]}
                    onPress={onConfirm}
                    disabled={busy || confirmDisabled}
                  >
                    <Text style={[styles.btnPrimaryText, danger && styles.btnDangerText]}>{confirmLabel || t('common.confirm')}</Text>
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
  bodyScroll: { flexGrow: 0, flexShrink: 1 },
  body: { marginBottom: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: { flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: 8, paddingVertical: 13, borderRadius: radius.ctrl, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: PRIMARY },
  btnDanger: { ...dangerButton },
  btnDangerText: { ...dangerButtonText, fontSize: rf(dangerButtonText.fontSize) },
  btnPrimaryText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(15), textAlign: 'center' },
  btnOutline: { borderWidth: 1.5, borderColor: PRIMARY },
  btnOutlineText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: rf(15), textAlign: 'center' },
  btnDisabled: { opacity: 0.5 },
  actionsCompact: { justifyContent: 'center' },
  btnSingle: { flex: 0, minWidth: 160, paddingHorizontal: 28 },
  btnCompact: { flex: 0, minHeight: 38, paddingVertical: 8, paddingHorizontal: 28 },
  btnTextCompact: { fontSize: rf(14) },
});
