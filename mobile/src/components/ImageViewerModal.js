import ProofDetails from './ProofDetails';

import { Modal, View, TouchableOpacity, StyleSheet } from 'react-native';

import ModalCloseButton from './ui/ModalCloseButton';
import RemoteImage from './RemoteImage';

// Full-screen image viewer. Pass a uri to show; onClose dismisses it.
export default function ImageViewerModal({ uri, visible, onClose, proof }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        {uri ? <RemoteImage uri={uri} style={styles.image} resizeMode="contain" /> : null}
        {uri && proof ? <ProofDetails proof={proof} /> : null}
        <ModalCloseButton tone="light" onPress={onClose} style={styles.closeBtn} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  image: { width: '92%', height: '60%' },
  closeBtn: { position: 'absolute', top: 40, right: 20 },
});
