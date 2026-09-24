import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { uploadToCloudinary } from '../lib/cloudinary';
import { rf } from '../lib/responsive';
import { colors, fonts, fontSize, radius } from '../theme/appTheme';
import RemoteImage from './RemoteImage';
import { useTranslation } from '../i18n/useTranslation';

// This stages a URL for the existing product/batch record; the parent owns
// persistence so selecting a photo can never modify a different batch.
export default function BatchPhotoField({ value, disabled, onChange, onStateChange, label }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const select = async (camera) => {
    if (disabled || busy) return;
    setBusy(true); setError(''); onStateChange?.('uploading');
    try {
      if (camera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error('Please allow camera access to take a photo.');
      }
      const result = camera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!result.canceled) {
        const url = await uploadToCloudinary(result.assets?.[0]);
        if (alive.current) onChange(url);
      }
      if (alive.current) onStateChange?.('ready');
    } catch (err) {
      if (alive.current) { setError(err.message || t('cmp.uploadFailed')); onStateChange?.('error'); }
    } finally { if (alive.current) setBusy(false); }
  };

  return <View style={{ gap: 8 }}>
    {(label ?? t('cmp.recentBatchPhoto')) ? <Text style={{ fontFamily: fonts.bodySemiBold, color: colors.ink }}>{label ?? t('cmp.recentBatchPhoto')} <Text style={{ color: colors.danger }}>*</Text></Text> : null}
    <Text style={{ fontFamily: fonts.body, color: colors.inkSoft, fontSize: rf(fontSize.sm) }}>{t('cmp.retailersSee')}</Text>
    {value ? (
      <RemoteImage uri={value} style={{ width: '100%', height: 150, borderRadius: radius.ctrl, backgroundColor: colors.leaf50 }} resizeMode="cover"
/>
    ) : (
      // Matches the prototype's photoMissing placeholder — a dashed box with
      // a camera icon, instead of leaving blank space before a photo exists.
      <View style={{ width: '100%', height: 150, borderRadius: radius.ctrl, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, backgroundColor: colors.leaf50, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <Ionicons name="camera-outline" size={28} color={colors.inkFaint} />
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.inkFaint }}>{t('cmp.noPhoto')}</Text>
      </View>
    )}
    {/* Once a photo is attached, upload is hidden and Take photo stays visible but disabled. */}
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {!value && (
        <TouchableOpacity disabled={disabled || busy} onPress={() => select(false)} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderWidth: 1, borderColor: colors.leaf700, borderRadius: radius.ctrl, opacity: disabled || busy ? 0.55 : 1 }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, color: colors.leaf700 }}>{busy ? 'Uploading…' : 'Upload photo'}</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity disabled={disabled || busy || !!value} accessibilityState={{ disabled: disabled || busy || !!value }} onPress={() => select(true)} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, backgroundColor: colors.leaf700, borderRadius: radius.ctrl, opacity: disabled || busy || value ? 0.55 : 1 }}>
        {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ fontFamily: fonts.bodySemiBold, color: '#fff' }}>{t('cmp.takePhoto')}</Text>}
      </TouchableOpacity>
    </View>
    {!!error && <Text accessibilityLiveRegion="polite" style={{ color: colors.danger, fontFamily: fonts.body }}>{error}</Text>}
  </View>;
}
