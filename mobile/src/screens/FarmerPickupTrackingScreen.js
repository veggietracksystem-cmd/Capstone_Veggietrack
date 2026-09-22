import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../api/client';
import { colors, fonts, fontSize, radius, shadowCard } from '../theme/appTheme';
import { rf } from '../lib/responsive';
import { useAutoSync } from '../sync/SyncProvider';
import DeliveryTrackingMap from '../components/DeliveryTrackingMap';
import usePickupTracking from '../hooks/usePickupTracking';
import ScreenHeader from '../components/ScreenHeader';
import StatusBadge from '../components/ui/StatusBadge';
import { Ionicons } from '@expo/vector-icons';
import RemoteImage from '../components/RemoteImage';

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
const FINAL_STATUSES = ['picked_up', 'completed'];
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
  // The backend has no separate 'completed' pickup state: 'picked_up' (set when
  // the rider submits proof) is final, so show it as the completed transaction.
  const displayStatus = FINAL_STATUSES.includes(pickup?.status) ? 'completed' : pickup?.status;
  const [label, detail] = STATUS[displayStatus] || [String(displayStatus || 'Pending').replace(/_/g, ' '), 'Pickup status updated.'];
  return <SafeAreaView style={s.container}>
    <ScreenHeader title="Pickup Tracking" onBack={() => navigation.goBack()} />
    <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false); }} />}>
      {loading && !pickup ? <ActivityIndicator color={colors.leaf700} style={{ padding: 32 }} /> : <>
        {/* Header card: id/veg summary + status badge on one row (prototype's
            farmer-pickup-tracking header row), status label/detail below. */}
        <Card>
          <View style={s.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.idLabel}>{pickup?.id ? `#${String(pickup.id).slice(0, 8)}` : ''}</Text>
              <Text style={s.status}>{label}</Text>
            </View>
            <StatusBadge status={displayStatus} label={label} />
          </View>
          <Text style={s.muted}>{detail}</Text>
          <Text style={s.muted}>Requested {date(pickup?.requested_at)}</Text>
        </Card>
        {!!error && <Text style={s.error}>{error} Pull down to retry.</Text>}
        {trackable ? (
          <Card title="Live tracking">
            <DeliveryTrackingMap trackingData={trackingData} style={s.map} />
            {!!trackingError && <Text style={s.error}>{trackingError} Pull down to retry.</Text>}
          </Card>
        ) : pickup?.status === 'requested' ? (
          <View style={s.banner}>
            <Ionicons name="time-outline" size={rf(20)} color={colors.gold700} />
            <View style={{ flex: 1 }}>
              <Text style={s.bannerTitle}>Waiting for rider assignment</Text>
              <Text style={s.bannerSub}>Live tracking will appear once a rider is assigned</Text>
            </View>
          </View>
        ) : null}
        <Card title="Status">
          <Timeline status={pickup?.status} pickup={pickup} />
        </Card>
        <Card title="Details">
          <Row label="Vegetables" value={`${pickup?.harvests?.vegetable_name || 'Vegetables'} · ${pickup?.harvests?.quantity_kg ?? '—'} kg`} />
          <Row label="Pickup location" value={pickup?.pickup_location?.address || 'Farm location not available'} />
          <Row label="Schedule" value={date(pickup?.requested_at)} />
          <Row label="Rider" value={pickup?.rider?.full_name || 'Not assigned yet'} />
          {!!pickup?.rider?.phone && <Row label="Contact" value={pickup.rider.phone} />}
          <Text style={s.muted}>ETA will appear when live rider-route data is available.</Text>
        </Card>
        {(pickup?.proof_photo_url || pickup?.pod) && <Card title="Proof of pickup">{pickup?.proof_photo_url && <RemoteImage uri={pickup.proof_photo_url} style={s.photo} />}<Text style={s.muted}>{pickup?.pod?.submitted_at ? `Recorded ${date(pickup.pod.submitted_at)}` : 'Pickup proof recorded'}</Text>{pickup?.pod?.latitude != null && <Text style={s.muted}>Location: {Number(pickup.pod.latitude).toFixed(5)}, {Number(pickup.pod.longitude).toFixed(5)}</Text>}</Card>}
      </>}
    </ScrollView>
  </SafeAreaView>;
}
function Card({ title, children }) { return <View style={s.card}>{title && <Text style={s.cardTitle}>{title}</Text>}{children}</View>; }
function Row({ label, value }) { return <View style={s.row}><Text style={s.muted}>{label}</Text><Text style={s.value}>{value}</Text></View>; }

// Same 5 real statuses the STATUS map above already understands — this only
// changes how they're *drawn* (connected dots instead of a flat list), it
// does not add, remove, or reorder any pickup state.
const STATUS_ORDER = ['requested', 'assigned', 'otw', 'picked_up', 'completed'];
function Timeline({ status, pickup }) {
  const currentIndex = FINAL_STATUSES.includes(status) ? STATUS_ORDER.length : Math.max(0, STATUS_ORDER.indexOf(status || 'requested'));
  return (
    <View>
      {STATUS_ORDER.map((key, i) => {
        const state = i < currentIndex ? 'done' : i === currentIndex ? 'active' : 'upcoming';
        const sub = key === 'requested' ? date(pickup?.requested_at)
          : key === 'assigned' ? (pickup?.rider?.full_name ? `Assigned to ${pickup.rider.full_name}` : '')
          : key === 'picked_up' ? (pickup?.received_at ? date(pickup.received_at) : '')
          : key === 'completed' && FINAL_STATUSES.includes(status) ? (pickup?.received_at ? date(pickup.received_at) : 'Proof of pickup recorded')
          : '';
        return (
          <View key={key} style={s.tlStep}>
            <View style={s.tlMarker}>
              <View style={[s.tlDot, state !== 'upcoming' && s.tlDotFilled]}>
                {state === 'done' && <Ionicons name="checkmark" size={rf(12)} color="#fff" />}
              </View>
              {i < STATUS_ORDER.length - 1 && <View style={[s.tlLine, state === 'done' && s.tlLineFilled]} />}
            </View>
            <View style={s.tlBody}>
              <Text style={[s.tlTitle, state === 'upcoming' && s.tlTitleUpcoming]}>{STATUS[key][0]}</Text>
              {!!sub && <Text style={s.muted}>{sub}</Text>}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({ container:{flex:1,backgroundColor:colors.bgScreen},content:{padding:16,gap:12,paddingBottom:32},card:{backgroundColor:colors.surface,borderRadius:radius.card,padding:16,gap:9,borderWidth:1,borderColor:colors.border,...shadowCard},cardTitle:{fontFamily:fonts.heading,fontSize:rf(fontSize.lg),color:colors.ink},status:{fontFamily:fonts.heading,fontSize:rf(fontSize.title),color:colors.leaf700},row:{flexDirection:'row',justifyContent:'space-between',gap:12},muted:{fontFamily:fonts.body,fontSize:rf(fontSize.sm),color:colors.inkSoft,flexShrink:1},value:{fontFamily:fonts.bodySemiBold,fontSize:rf(fontSize.sm),color:colors.ink,flexShrink:1,textAlign:'right'},error:{fontFamily:fonts.body,color:colors.danger},photo:{width:'100%',height:210,borderRadius:radius.ctrl,resizeMode:'cover'},map:{height:380,flex:0,marginTop:4},
  headerRow:{flexDirection:'row',alignItems:'flex-start',justifyContent:'space-between',gap:10},
  idLabel:{fontFamily:fonts.bodySemiBold,fontSize:rf(fontSize.xs),color:colors.inkFaint,textTransform:'uppercase',letterSpacing:0.3},
  banner:{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:colors.leaf50,borderWidth:1,borderColor:colors.border,borderRadius:radius.card,padding:14},
  bannerTitle:{fontFamily:fonts.bodyBold,fontSize:rf(fontSize.sm),color:colors.ink},
  bannerSub:{fontFamily:fonts.body,fontSize:rf(fontSize.xs),color:colors.inkSoft,marginTop:2},
  tlStep:{flexDirection:'row',gap:10},
  tlMarker:{alignItems:'center'},
  tlDot:{width:20,height:20,borderRadius:10,borderWidth:2,borderColor:colors.border,backgroundColor:colors.card,alignItems:'center',justifyContent:'center'},
  tlDotFilled:{backgroundColor:colors.leaf700,borderColor:colors.leaf700},
  tlLine:{width:2,flex:1,minHeight:20,backgroundColor:colors.border},
  tlLineFilled:{backgroundColor:colors.leaf700},
  tlBody:{flex:1,paddingBottom:14},
  tlTitle:{fontFamily:fonts.bodySemiBold,fontSize:rf(fontSize.sm),color:colors.ink},
  tlTitleUpcoming:{color:colors.inkFaint,fontFamily:fonts.body},
});
