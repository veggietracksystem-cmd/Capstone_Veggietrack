import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import CustomModal from './CustomModal';
import { useTranslation } from '../i18n/useTranslation';

// Imperative singleton controller so lib/ui.js can trigger the modal from
// anywhere (event handlers, non-component code) without prop-drilling.
// Populated by AlertModalHost's effect once it mounts.
let controller = null;

export function showAlertModal(title, message, onPress) {
  if (!controller) return;
  controller.show({ mode: 'alert', title, message, onPress });
}

export function confirmActionModal(title, message, onConfirm) {
  if (!controller) return;
  controller.show({ mode: 'confirm', title, message, onConfirm });
}

// Mount once near the app root (see App.js) so every screen can trigger
// branded alert/confirm dialogs via showAlertModal/confirmActionModal below.
export default function AlertModalHost() {
  const { t } = useTranslation();
  const [state, setState] = useState(null);

  useEffect(() => {
    controller = { show: setState };
    return () => { controller = null; };
  }, []);

  if (!state) return null;

  const close = () => setState(null);

  const handleConfirm = () => {
    close();
    state.onConfirm?.();
  };

  const handleDismiss = () => {
    close();
    if (state.mode === 'alert') state.onPress?.();
  };

  return (
    <CustomModal
      visible={!!state}
      title={state.title}
      confirmLabel={state.mode === 'confirm' ? t('common.confirm') : t('common.ok')}
      onConfirm={state.mode === 'confirm' ? handleConfirm : handleDismiss}
      cancelLabel={state.mode === 'confirm' ? t('common.cancel') : undefined}
      onCancel={state.mode === 'confirm' ? close : undefined}
    >
      <Text>{state.message}</Text>
    </CustomModal>
  );
}
