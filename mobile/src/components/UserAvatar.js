import { useState } from 'react';
import { Text, View } from 'react-native';
import { colors, fonts } from '../theme/appTheme';
import RemoteImage from './RemoteImage';

export default function UserAvatar({ user, size = 68, style, textStyle }) {
  const uri = user?.avatar_url;
  const [failedUri, setFailedUri] = useState(null);
  const initial = (user?.full_name || user?.name || user?.email || '?').trim().charAt(0).toUpperCase();
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2,
      backgroundColor: colors.leaf100, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, style]}>
      {uri && uri !== failedUri ? (
        <RemoteImage key={uri} uri={uri} accessibilityLabel={user?.full_name || user?.name || ''}
          style={{ width: '100%', height: '100%' }} resizeMode="cover" onError={() => setFailedUri(uri)} />
      ) : <Text style={[{ fontFamily: fonts.heading, fontSize: size * 0.41, color: colors.leaf700 }, textStyle]}>{initial || '?'}</Text>}
    </View>
  );
}
