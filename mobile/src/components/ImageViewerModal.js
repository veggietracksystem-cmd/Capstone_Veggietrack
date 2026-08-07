import { rf } from '../lib/responsive';
import { Modal, View, Image, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { fonts, radius } from '../theme/appTheme';

// Full-screen image viewer. Pass a uri to show; onClose dismisses it.
export default function ImageViewerModal({ uri, visible, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Tap anywhere behind the image to dismiss */}
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        {uri ? <Image source={{ uri }} style={styles.image} resizeMode="contain" /> : null}
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeText}>Close ✕</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  image: { width: '92%', height: '75%' },
  closeBtn: { position: 'absolute', top: 40, right: 20, paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.ctrl, backgroundColor: 'rgba(255,255,255,0.15)' },
  closeText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(15) },
});
