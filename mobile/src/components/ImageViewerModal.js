import ProofDetails from './ProofDetails';
import { rf } from '../lib/responsive';
import { Modal, View, TouchableOpacity, StyleSheet } from 'react-native';
import { radius } from '../theme/appTheme';
import { Ionicons } from '@expo/vector-icons';
import RemoteImage from './RemoteImage';

// Full-screen image viewer. Pass a uri to show; onClose dismisses it.
export default function ImageViewerModal({ uri, visible, onClose, proof }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Tap anywhere behind the image to dismiss */}
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        {uri ? <RemoteImage uri={uri} style={styles.image} resizeMode="contain" /> : null}
        {uri && <ProofDetails proof={proof} />}
        <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Ionicons name="close" size={rf(18)} color="#fff" />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  image: { width: '92%', height: '60%' },
  // Same small rounded outlined close button every other modal uses (tinted
  // for the dark photo backdrop here).
  closeBtn: {
    position: 'absolute', top: 40, right: 20, width: 38, height: 38,
    borderRadius: radius.ctrl, backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
});
