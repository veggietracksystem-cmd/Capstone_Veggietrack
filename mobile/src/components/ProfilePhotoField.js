import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { uploadToCloudinary } from '../lib/cloudinary';
import { useTranslation } from '../i18n/useTranslation';
import { colors, fonts } from '../theme/appTheme';
import UserAvatar from './UserAvatar';

// Selection/upload is staged here; only the parent's Save persists the URL.
export default function ProfilePhotoField({ user, value, disabled, onChange, onStateChange }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const choose = async () => {
    if (disabled || locked.current) return;
    locked.current = true;
    setBusy(true); onStateChange('uploading');
    // Keep a previous failure pending if the user cancels a retry.
    let nextState = error ? 'error' : 'ready';
    try {
      // Must launch directly from the tap on web (no preceding permission await).
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!result.canceled) {
        const url = await uploadToCloudinary(result.assets?.[0]);
        if (alive.current) { onChange(url); setError(''); }
        nextState = 'ready';
      }
    } catch {
      nextState = 'error';
      if (alive.current) setError(t('avatar.uploadFailed'));
    } finally {
      locked.current = false;
      if (alive.current) { setBusy(false); onStateChange(nextState); }
    }
  };

  // Staged like a new picture: the avatar falls back to initials right away and
  // the removal is saved with the parent's Save button.
  const remove = () => {
    if (disabled || busy || !value) return;
    setError(''); onChange(null);
  };

  return <View style={{ marginBottom: 16, gap: 8 }}>
    <Text style={{ fontFamily: fonts.bodySemiBold, color: colors.inkSoft }}>{t('avatar.title')}</Text>
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 14 }}>
      <UserAvatar user={{ ...user, avatar_url: value }} />
      <TouchableOpacity accessibilityRole="button" disabled={disabled || busy} onPress={choose}
        style={{ opacity: disabled || busy ? 0.6 : 1, paddingVertical: 10 }}>
        {busy ? <ActivityIndicator color={colors.leaf700} /> :
          <Text style={{ fontFamily: fonts.bodySemiBold, color: colors.leaf700 }}>{t(value ? 'avatar.replace' : 'avatar.choose')}</Text>}
      </TouchableOpacity>
      {!!value && (
        <TouchableOpacity accessibilityRole="button" disabled={disabled || busy} onPress={remove}
          style={{ opacity: disabled || busy ? 0.6 : 1, paddingVertical: 10 }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, color: colors.danger }}>{t('avatar.remove')}</Text>
        </TouchableOpacity>
      )}
    </View>
    {!!error && <Text accessibilityLiveRegion="polite" style={{ color: colors.danger }}>{error}</Text>}
    <Text style={{ fontFamily: fonts.body, color: colors.inkSoft }}>{t('avatar.saveHint')}</Text>
  </View>;
}
