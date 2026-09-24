import ProofDetails from './ProofDetails';
import { useTranslation } from '../i18n/useTranslation';
import { rf } from '../lib/responsive';
import { Modal, View, Text, Image, TouchableOpacity, ActivityIndicator, Animated, StyleSheet } from 'react-native';
import { colors, control, fonts, radius, shadowCard } from '../theme/appTheme';
import { useSharedModalMotion } from '../lib/motion';

const PRIMARY = colors.leaf700;

/**
 * Confirm-delivery modal with proof-of-delivery preview.
 *
 * The photo is only uploaded when the driver taps "Confirm & Upload" — picking a
 * photo stages it with current GPS for preview. Both are required.
 *
 * Props:
 *  - visible:    show/hide
 *  - orderLabel: short text shown in the title (e.g. "#a1b2c3d4")
 *  - photo:      picked asset ({ uri }) or null
 *  - busy:       true while uploading/completing (disables buttons, shows spinner)
 *  - onPickPhoto: open the camera/library to attach or replace the photo
 *  - onConfirm:  upload required photo/GPS + mark delivered
 *  - onCancel:   dismiss without changes
 */
export default function ProofPreviewModal({
  visible, orderLabel, photo, busy, onPickPhoto, onConfirm, onCancel,
  title, confirmIdleLabel,
}) {
  const { t } = useTranslation();
  const { backdropStyle, cardStyle } = useSharedModalMotion(visible);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={busy ? undefined : onCancel}>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Animated.View style={[styles.card, cardStyle]}>
          <Text style={styles.title}>{title ?? t('cmp.confirmDelivery')}</Text>
          {orderLabel ? <Text style={styles.subtitle}>{t('cmp2.orderN', { label: orderLabel })}</Text> : null}

          {photo ? (
            <>
              <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="contain" />
              <ProofDetails proof={photo.pod} />
              <TouchableOpacity onPress={onPickPhoto} disabled={busy}>
                <Text style={styles.retakeLink}>{t('cmp.retake')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={styles.addPhotoBtn} onPress={onPickPhoto} disabled={busy}>
              <Text style={styles.addPhotoText}>{t('cmp.addProof')}</Text>
              <Text style={styles.optionalText}>{t('pod.required')}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.button, styles.buttonPrimary, (busy || !photo?.uri) && styles.buttonDisabled]}
            onPress={onConfirm}
            disabled={busy || !photo?.uri}
          >
            {busy
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.buttonPrimaryText}>{photo ? t('cmp.confirmUpload') : (confirmIdleLabel ?? t('cmp.confirmDelivery'))}</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.buttonOutline, busy && styles.buttonDisabled]}
            onPress={onCancel}
            disabled={busy}
          >
            <Text style={styles.buttonOutlineText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,17,16,0.42)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 360, backgroundColor: colors.bgScreen, borderRadius: radius.card, padding: 22, ...shadowCard },
  title: { fontFamily: fonts.heading, fontSize: rf(18), color: colors.ink },
  subtitle: { fontFamily: fonts.body, fontSize: rf(13), color: colors.inkSoft, marginTop: 2, marginBottom: 14 },

  preview: { width: '100%', height: 200, borderRadius: radius.ctrl, backgroundColor: colors.border },
  retakeLink: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: rf(14), textAlign: 'center', paddingVertical: 12 },

  addPhotoBtn: { paddingVertical: 24, borderRadius: radius.ctrl, alignItems: 'center', borderWidth: 1, borderColor: PRIMARY, borderStyle: 'dashed', marginBottom: 8, justifyContent: 'center', minHeight: control.height },
  addPhotoText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: rf(15) },
  optionalText: { fontFamily: fonts.body, color: colors.inkFaint, fontSize: rf(12), marginTop: 4 },

  button: { paddingVertical: 14, borderRadius: radius.ctrl, alignItems: 'center', marginTop: 10 },
  buttonPrimary: { backgroundColor: PRIMARY },
  buttonPrimaryText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(15.5) },
  buttonOutline: { borderWidth: 1.4, borderColor: PRIMARY },
  buttonOutlineText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: rf(15.5) },
  buttonDisabled: { opacity: 0.6 },
});
