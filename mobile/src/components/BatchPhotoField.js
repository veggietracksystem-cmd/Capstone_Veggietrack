import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Text, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { uploadToCloudinary } from '../lib/cloudinary';
import { colors, fonts, radius } from '../theme/appTheme';

// This stages a URL for the existing product/batch record; the parent owns
// persistence so selecting a photo can never modify a different batch.
export default function BatchPhotoField({ value, disabled, onChange, onStateChange }) {
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
        if (!permission.granted) throw new Error('Camera permission is needed to take a batch photo.');
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
      if (alive.current) { setError(err.message || 'Unable to upload the batch photo. Please try again.'); onStateChange?.('error'); }
    } finally { if (alive.current) setBusy(false); }
  };

  return <View style={{ gap: 8 }}>
    <Text style={{ fontFamily: fonts.bodySemiBold, color: colors.ink }}>Recent Batch Photo <Text style={{ color: colors.danger }}>*</Text></Text>
    <Text style={{ fontFamily: fonts.body, color: colors.inkSoft, fontSize: 12 }}>Upload or take a photo of this received batch. Retailers will see it in the ordering menu.</Text>
    {value ? <Image source={{ uri: value }} style={{ width: '100%', height: 150, borderRadius: radius.ctrl, backgroundColor: colors.leaf50 }} resizeMode="cover" /> : null}
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <TouchableOpacity disabled={disabled || busy} onPress={() => select(false)} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderWidth: 1, borderColor: colors.leaf700, borderRadius: radius.ctrl, opacity: disabled || busy ? 0.55 : 1 }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, color: colors.leaf700 }}>{busy ? 'Uploading…' : value ? 'Replace photo' : 'Upload photo'}</Text>
      </TouchableOpacity>
      <TouchableOpacity disabled={disabled || busy} onPress={() => select(true)} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, backgroundColor: colors.leaf700, borderRadius: radius.ctrl, opacity: disabled || busy ? 0.55 : 1 }}>
        {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ fontFamily: fonts.bodySemiBold, color: '#fff' }}>Take photo</Text>}
      </TouchableOpacity>
    </View>
    {!!error && <Text accessibilityLiveRegion="polite" style={{ color: colors.danger, fontFamily: fonts.body }}>{error}</Text>}
  </View>;
}
