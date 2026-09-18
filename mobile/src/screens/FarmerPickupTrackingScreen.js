import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../api/client';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';
import { useAutoSync } from '../sync/SyncProvider';
import DeliveryTrackingMap from '../components/DeliveryTrackingMap';
import usePickupTracking from '../hooks/usePickupTracking';

const STATUS = {
  requested: ['Pending', 'Your request is waiting for distributor action.'],
  assigned: ['Rider Assigned', 'A rider has been assigned to collect your vegetables.'],
  otw: ['Rider On The Way', 'Your rider is heading to your farm to collect the vegetables.'],
  picked_up: ['Picked Up', 'Your vegetables have been collected. This pickup is complete.'],
  completed: ['Completed', 'This pickup transaction has been completed.'],
};
// A live map is only meaningful once a rider is assigned and has not yet
// arrived — before that there is nothing to track, and after pickup the
// journey is over (the Proof of pickup card below takes over).
const TRACKABLE_STATUSES = ['assigned', 'otw'];
const date = value => value ? new Date(value).toLocaleString() : '—';

export default function FarmerPickupTrackingScreen({ navigation, route }) {
  const id = route.params?.pickupId;
  const [pickup, setPickup] = useState(route.params?.pickup || null);
  const [loading, setLoading] = useState(!pickup);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const list = await api.get('/api/pickup-requests');
      const next = (Array.isArray(list) ? list : []).find(row => row.id === id);
      if (!next) throw new Error('Pickup request is no longer available.');
      setPickup(next); setError('');
    } catch (err) { setError(err.message || 'Could not refresh pickup tracking.'); }
    finally { setLoading(false); }
  }, [id]);
  useAutoSync(`farmer-pickup-${id || 'unknown'}`, refresh);
  useEffect(() => { refresh(); }, [refresh]);
  const trackable = TRACKABLE_STATUSES.includes(pickup?.status);
  const { data: trackingData, error: trackingError } = usePickupTracking(trackable ? id : null);
  const [label, detail] = STATUS[pickup?.status] || [String(pickup?.status || 'Pending').replace(/_/g, ' '), 'Pickup status updated.'];
  return <SafeAreaView style={s.container}>
    <View style={s.header}><TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>‹ Back</Text></TouchableOpacity><Text style={s.title}>Pickup Tracking</Text><View style={{ width: 40 }} /></View>
    <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false); }} />}>
      {loading && !pickup ? <ActivityIndicator color={colors.leaf700} style={{ padding: 32 }} /> : <>
        <Card><Text style={s.status}>{label}</Text><Text style={s.muted}>{detail}</Text><Text style={s.muted}>Requested {date(pickup?.requested_at)}</Text></Card>
        {!!error && <Text style={s.error}>{error} Pull down to retry.</Text>}
        {trackable && <Card title="Live tracking">
          <DeliveryTrackingMap trackingData={trackingData} style={s.map} />
          {!!trackingError && <Text style={s.error}>{trackingError} Pull down to retry.</Text>}
        </Card>}
        <Card title="Vegetables"><Row label="Product" value={pickup?.harvests?.vegetable_name || 'Vegetables'} /><Row label="Quantity" value={`${pickup?.harvests?.quantity_kg ?? '—'} kg`} /><Row label="Pickup schedule" value={date(pickup?.requested_at)} /></Card>
        <Card title="Pickup location"><Text style={s.value}>{pickup?.pickup_location?.address || 'Farm location not available'}</Text></Card>
        <Card title="Rider"><Row label="Assigned rider" value={pickup?.rider?.full_name || 'Not assigned yet'} />{!!pickup?.rider?.phone && <Row label="Contact" value={pickup.rider.phone} />}<Text style={s.muted}>ETA will appear when live rider-route data is available.</Text></Card>
        <Card title="Status updates"><Row label="Request submitted" value={date(pickup?.requested_at)} />{pickup?.delivery_personnel_id && <Row label="Rider assigned" value="Assigned" />}{pickup?.status === 'otw' && <Row label="Rider on the way" value="In progress" />}{pickup?.received_at && <Row label="Picked up" value={date(pickup.received_at)} />}</Card>
        {(pickup?.proof_photo_url || pickup?.pod) && <Card title="Proof of pickup">{pickup?.proof_photo_url && <Image source={{ uri: pickup.proof_photo_url }} style={s.photo} />}<Text style={s.muted}>{pickup?.pod?.submitted_at ? `Recorded ${date(pickup.pod.submitted_at)}` : 'Pickup proof recorded'}</Text>{pickup?.pod?.latitude != null && <Text style={s.muted}>Location: {Number(pickup.pod.latitude).toFixed(5)}, {Number(pickup.pod.longitude).toFixed(5)}</Text>}</Card>}
      </>}
    </ScrollView>
  </SafeAreaView>;
}
function Card({ title, children }) { return <View style={s.card}>{title && <Text style={s.cardTitle}>{title}</Text>}{children}</View>; }
function Row({ label, value }) { return <View style={s.row}><Text style={s.muted}>{label}</Text><Text style={s.value}>{value}</Text></View>; }
const s = StyleSheet.create({ container:{flex:1,backgroundColor:colors.bgScreen},header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',padding:16},back:{fontFamily:fonts.bodySemiBold,color:colors.leaf700},title:{fontFamily:fonts.heading,fontSize:18,color:colors.ink},content:{padding:16,gap:12,paddingBottom:32},card:{backgroundColor:colors.card,borderRadius:radius.card,padding:16,gap:9,borderWidth:1,borderColor:colors.border,...shadowCard},cardTitle:{fontFamily:fonts.heading,fontSize:16,color:colors.ink},status:{fontFamily:fonts.heading,fontSize:19,color:colors.leaf700},row:{flexDirection:'row',justifyContent:'space-between',gap:12},muted:{fontFamily:fonts.body,fontSize:13,color:colors.inkSoft,flexShrink:1},value:{fontFamily:fonts.bodySemiBold,fontSize:13,color:colors.ink,flexShrink:1,textAlign:'right'},error:{fontFamily:fonts.body,color:colors.danger},photo:{width:'100%',height:210,borderRadius:radius.ctrl,resizeMode:'cover'},map:{height:380,flex:0,marginTop:4} });
