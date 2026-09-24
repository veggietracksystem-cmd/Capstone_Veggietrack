import ProofDetails from './ProofDetails';
import { rf } from '../lib/responsive';
import { Modal, View, TouchableOpacity, StyleSheet } from 'react-native';
import { radius } from '../theme/appTheme';
import ModalCloseButton from './ui/ModalCloseButton';
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
        <ModalCloseButton tone="light" onPress={onClose} style={styles.closeBtn} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  image: { width: '92%', height: '60%' },
  // Same small rounded outlined close button every other modal uses (tinted
  // for the dark photo backdrop here).
  closeBtn: { position: 'absolute', top: 40, right: 20 },
});
