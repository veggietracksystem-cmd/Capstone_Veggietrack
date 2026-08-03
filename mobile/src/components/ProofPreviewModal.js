import { useEffect, useRef } from 'react';
import { Modal, View, Text, Image, TouchableOpacity, ActivityIndicator, Animated, StyleSheet } from 'react-native';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';

const PRIMARY = colors.leaf700;

/**
 * Confirm-delivery modal with proof-of-delivery preview.
 *
 * The photo is only uploaded when the driver taps "Confirm & Upload" — picking a
 * photo just stages it here for preview. A proof photo is optional; without one
 * the primary button reads "Confirm Delivery".
 *
 * Props:
 *  - visible:    show/hide
 *  - orderLabel: short text shown in the title (e.g. "#a1b2c3d4")
 *  - photo:      picked asset ({ uri }) or null
 *  - busy:       true while uploading/completing (disables buttons, shows spinner)
 *  - onPickPhoto: open the camera/library to attach or replace the photo
 *  - onConfirm:  upload (if any) + mark delivered
 *  - onCancel:   dismiss without changes
 */
export default function ProofPreviewModal({
  visible, orderLabel, photo, busy, onPickPhoto, onConfirm, onCancel,
}) {
  // Subtle scale/fade entrance for a smoother feel (Issue 1).
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
        <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
          <Text style={styles.title}>Confirm Delivery</Text>
          {orderLabel ? <Text style={styles.subtitle}>Order {orderLabel}</Text> : null}

          {photo ? (
            <>
              <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="cover" />
              <TouchableOpacity onPress={onPickPhoto} disabled={busy}>
                <Text style={styles.retakeLink}>Retake photo</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={styles.addPhotoBtn} onPress={onPickPhoto} disabled={busy}>
              <Text style={styles.addPhotoText}>📷 Add Proof Photo</Text>
              <Text style={styles.optionalText}>(optional)</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.button, styles.buttonPrimary, busy && styles.buttonDisabled]}
            onPress={onConfirm}
            disabled={busy}
          >
            {busy
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.buttonPrimaryText}>{photo ? 'Confirm & Upload' : 'Confirm Delivery'}</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.buttonOutline, busy && styles.buttonDisabled]}
            onPress={onCancel}
            disabled={busy}
          >
            <Text style={styles.buttonOutlineText}>Cancel</Text>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,17,16,0.42)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 360, backgroundColor: colors.bgScreen, borderRadius: radius.card, padding: 22, ...shadowCard },
  title: { fontFamily: fonts.heading, fontSize: 18, color: colors.ink },
  subtitle: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft, marginTop: 2, marginBottom: 14 },

  preview: { width: '100%', height: 200, borderRadius: radius.ctrl, backgroundColor: colors.border },
  retakeLink: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: 14, textAlign: 'center', paddingVertical: 12 },

  addPhotoBtn: { paddingVertical: 24, borderRadius: radius.ctrl, alignItems: 'center', borderWidth: 1, borderColor: PRIMARY, borderStyle: 'dashed', marginBottom: 8 },
  addPhotoText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: 15 },
  optionalText: { fontFamily: fonts.body, color: colors.inkFaint, fontSize: 12, marginTop: 4 },

  button: { paddingVertical: 14, borderRadius: radius.ctrl, alignItems: 'center', marginTop: 10 },
  buttonPrimary: { backgroundColor: PRIMARY },
  buttonPrimaryText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: 15.5 },
  buttonOutline: { borderWidth: 1.4, borderColor: PRIMARY },
  buttonOutlineText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: 15.5 },
  buttonDisabled: { opacity: 0.6 },
});
