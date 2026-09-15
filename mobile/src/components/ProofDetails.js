import { View, Text } from 'react-native';
import { colors, fonts } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';

export default function ProofDetails({ proof }) {
  const { t } = useTranslation();
  const style = { color: colors.ink, fontFamily: fonts.body, fontSize: 13, marginTop: 4 };
  const format = value => value ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) + ' PHT' : '';
  return <View style={{ padding: 12, backgroundColor: colors.leaf50, borderRadius: 10 }}>
    {proof?.captured_at && <Text style={style}>{t('pod.captured')}: {format(proof.captured_at)}</Text>}
    {proof?.submitted_at && <Text style={style}>{t('pod.submitted')}: {format(proof.submitted_at)}</Text>}
    {proof?.address && <Text style={style}>{proof.address}</Text>}
    {Number.isFinite(proof?.latitude) && Number.isFinite(proof?.longitude) && <Text style={style}>{t('pod.coordinates')}: {proof.latitude.toFixed(6)}, {proof.longitude.toFixed(6)}</Text>}
    <Text style={style}>{t(proof?.location_status === 'verified' ? 'pod.verified' : 'pod.unverified')}</Text>
    {Number.isFinite(proof?.distance_meters) && <Text style={style}>{t('pod.distance')}: {Math.round(proof.distance_meters)} m</Text>}
  </View>;
}
