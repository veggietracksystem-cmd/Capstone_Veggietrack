import { currentProofLocation, captureProofPhoto } from '../lib/podCapture';
import { useState, useEffect, useRef } from 'react';
import { Text, View, ScrollView, TouchableOpacity, TextInput, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import api from '../api/client';
import { uploadToCloudinary } from '../lib/cloudinary';
import { createProofSubmission, proofFailureMessage } from '../lib/podSubmission';
import { orderDestination, validateDeliveryLocation, MISSING_DESTINATION_MESSAGE, REFRESH_ACCURACY_MESSAGE } from '../lib/deliveryLocation';
import { isOnline } from '../offline/net';
import DeliveryMapModal from '../components/DeliveryMapModal';
import ProofPreviewModal from '../components/ProofPreviewModal';
import CustomModal from '../components/CustomModal';
import { showAlert, peso, shortId } from '../lib/ui';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { statusColor, formatStatus, getDelivery, effectiveStatus, STATUS_RANK } from './DeliveryDashboard';
import { rf } from '../lib/responsive';
import { localizeVegetableName } from '../lib/vegetableNames';
import { useAutoSync } from '../sync/SyncProvider';

const PRIMARY = colors.leaf700;

// The rider-facing progression: assigned -> picked_up -> in_transit -> (Mark Delivered).
// Steps already reached render as a completed indicator; the very next step
// renders as the single actionable button — everything else stays hidden.
const PROGRESS_STEPS = [
  { key: 'picked_up', rank: 1 },
  { key: 'in_transit', rank: 2 },
];

// Formats the retailer's preferred delivery schedule as separate date/time
// lines for display — never the raw ISO timestamp the backend stores it as.
function formatScheduleParts(preferredSchedule) {
  if (!preferredSchedule) return null;
  const d = new Date(preferredSchedule);
  if (isNaN(d.getTime())) return null;
  return {
    date: d.toLocaleDateString(undefined, { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' }),
    time: d.toLocaleTimeString(undefined, { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }),
  };
}

export default function DeliveryDetailsScreen({ navigation, route }) {
  const { t, language } = useTranslation();
  const [order, setOrder] = useState(route.params?.order);
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [mapAddress, setMapAddress] = useState(null);
  const [mapCoords, setMapCoords] = useState(null);
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [rejectReasonKey, setRejectReasonKey] = useState(null);
  const [rejectOtherText, setRejectOtherText] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [locationDetails, setLocationDetails] = useState(null);
  const [locationError, setLocationError] = useState('');
  const actionRef = useRef(null);
  const submissionRef = useRef(null);
  const locationGeneration = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const requestGeneration = ++locationGeneration.current;
    if (order && !['delivered', 'cancelled'].includes(effectiveStatus(order))) {
      currentProofLocation(t).then(position => {
        if (cancelled || requestGeneration !== locationGeneration.current) return;
        try { setLocationDetails(validateDeliveryLocation(position, orderDestination(order))); setLocationError(''); }
        catch (error) { setLocationDetails(Number.isFinite(error.distanceMeters) ? error : null); setLocationError(error.code === 'GPS_INACCURATE' ? REFRESH_ACCURACY_MESSAGE : error.message); }
      }).catch(error => { if (!cancelled && requestGeneration === locationGeneration.current) setLocationError(error.code === 'GPS_INACCURATE' ? REFRESH_ACCURACY_MESSAGE : error.message); });
    }
    return () => { cancelled = true; mounted.current = false; };
  }, [order?.id]);

  const refreshOrder = async () => {
    if (!order?.id) return;
    try {
      const list = await api.get('/api/delivery/orders');
      const updated = (Array.isArray(list) ? list : []).find((o) => o.id === order.id);
      if (updated) setOrder(updated);
    } catch {
      // keep showing the last known state
    }
  };
  useAutoSync(`delivery-details-${order?.id || 'unknown'}`, refreshOrder);

  if (!order) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.back}>‹ {t('common.back')}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{t('deliveryDetails.title')}</Text>
          <View style={{ width: 50 }} />
        </View>
      </SafeAreaView>
    );
  }

  const delivery = getDelivery(order);
  const status = effectiveStatus(order);
  const rank = STATUS_RANK[status] ?? 0;
  const finished = status === 'delivered' || status === 'cancelled';
  const items = order.order_items || [];
  const scheduleParts = formatScheduleParts(order.preferred_schedule);
  // Single Route button: routes to the pickup warehouse until the rider has
  // picked up, then to the retailer's delivery address — same map modal and
  // coordinates as before, just one button instead of two.
  const routeTarget = rank < 1
    ? { address: order.distributor_address, coords: order.distributor_coords }
    : { address: order.retailer_address, coords: orderDestination(order) };

  const verifiedLocation = async () => {
    const requestGeneration = ++locationGeneration.current;
    if (!orderDestination(order)) throw new Error(MISSING_DESTINATION_MESSAGE);
    const position = await currentProofLocation(t);
    try {
      const details = validateDeliveryLocation(position, orderDestination(order));
      if (mounted.current && requestGeneration === locationGeneration.current) { setLocationDetails(details); setLocationError(''); }
      return position;
    } catch (error) {
      if (mounted.current && requestGeneration === locationGeneration.current) { setLocationDetails(Number.isFinite(error.distanceMeters) ? error : null); setLocationError(error.message); }
      throw error;
    }
  };

  const refreshLocation = async () => {
    if (actionRef.current) return;
    actionRef.current = 'location'; setBusy(true);
    try { await verifiedLocation(); }
    catch (error) { setLocationError(error.code === 'GPS_INACCURATE' ? REFRESH_ACCURACY_MESSAGE : error.message); }
    finally { actionRef.current = null; if (mounted.current) setBusy(false); }
  };

  const updateStatus = async (newStatus) => {
    if (actionRef.current) return;
    if (!delivery?.id) {
      showAlert(t('dashboards.delivery.missingDeliveryTitle'), t('dashboards.delivery.pullToRefreshRetry'));
      return;
    }
    actionRef.current = 'status'; setBusy(true);
    try {
      await api.put(`/api/deliveries/${delivery.id}/status`, { status: newStatus });
      await refreshOrder();
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      actionRef.current = null;
      setBusy(false);
    }
  };

  const openProof = async () => {
    if (actionRef.current) return;
    actionRef.current = 'location'; setBusy(true);
    try {
      await verifiedLocation();
      setConfirmVisible(true);
    } catch (err) { showAlert(t('common.error'), err.message); }
    finally { actionRef.current = null; setBusy(false); }
  };
  const pickPhoto = async () => {
    if (actionRef.current) return;
    actionRef.current = 'photo'; setBusy(true);
    try {
      const selected = await captureProofPhoto(t, ImagePicker, Platform.OS, setPhoto);
      if (selected) setPhoto(selected);
    } catch (err) {
      if (err.selectedPhoto) setPhoto(err.selectedPhoto);
      showAlert(t('common.error'), err.message || t('dashboards.delivery.cameraErrorFallback'));
    } finally { actionRef.current = null; setBusy(false); }
  };

  const REJECT_REASON_PRESETS = [
    { key: 'vehicle_breakdown', label: t('dashboards.delivery.rejectReasonVehicleBreakdown') },
    { key: 'not_available', label: t('dashboards.delivery.rejectReasonNotAvailable') },
    { key: 'personal_emergency', label: t('dashboards.delivery.rejectReasonPersonalEmergency') },
    { key: 'other', label: t('dashboards.delivery.rejectReasonOther') },
  ];

  const openRejectModal = () => {
    setRejectReasonKey(null);
    setRejectOtherText('');
    setRejectModalVisible(true);
  };

  const submitReject = async () => {
    if (actionRef.current) return;
    if (!delivery?.id) {
      showAlert(t('dashboards.delivery.missingDeliveryTitle'), t('dashboards.delivery.pullToRefreshRetry'));
      return;
    }
    const preset = REJECT_REASON_PRESETS.find((r) => r.key === rejectReasonKey);
    const reason = rejectReasonKey === 'other' ? rejectOtherText.trim() : preset?.label;
    if (!reason) {
      showAlert(t('common.error'), t('dashboards.delivery.rejectReasonRequired'));
      return;
    }
    actionRef.current = 'reject'; setRejecting(true); setBusy(true);
    try {
      await api.put(`/api/deliveries/${delivery.id}/reject`, { reason });
      setRejectModalVisible(false);
      showAlert(t('dashboards.delivery.rejectedTitle'), t('dashboards.delivery.rejectedMessage', { id: shortId(order.id) }));
      // The order is no longer assigned to this rider — nothing left to show here.
      navigation.goBack();
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      actionRef.current = null; setRejecting(false); setBusy(false);
    }
  };

  const markDelivered = async () => {
    if (actionRef.current) return;
    if (!delivery?.id) {
      showAlert(t('dashboards.delivery.missingDeliveryTitle'), t('dashboards.delivery.missingDeliveryIdMessage'));
      return;
    }
    actionRef.current = 'complete'; setBusy(true);
    try {
      if (!submissionRef.current || submissionRef.current.id !== delivery.id) {
        submissionRef.current = { id: delivery.id, controller: createProofSubmission({ upload: uploadToCloudinary, isOnline,
          complete: body => api.put(`/api/deliveries/${delivery.id}/complete`, body) }) };
      }
      await submissionRef.current.controller.submit({ photo, getLocation: verifiedLocation });
      // A failed follow-up refresh cannot leave an already confirmed delivery actionable.
      setOrder(current => ({ ...current, status: 'delivered', deliveries: Array.isArray(current.deliveries)
        ? current.deliveries.map(item => item.id === delivery.id ? { ...item, status: 'delivered' } : item)
        : { ...current.deliveries, status: 'delivered' } }));
      setPhoto(null);
      setConfirmVisible(false);
      await refreshOrder();
      showAlert(t('dashboards.delivery.deliveredTitle'), t('dashboards.delivery.deliveredMessage', { id: shortId(order.id) }));
    } catch (err) {
      showAlert(t('common.error'), proofFailureMessage(err));
    } finally {
      actionRef.current = null;
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>‹ {t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('deliveryDetails.title')}</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          {/* 1. Order Summary — status shown exactly once, as the badge */}
          <View style={styles.orderHeader}>
            <Text style={styles.orderId}>{t('dashboards.distributor.orderNumber', { id: shortId(order.id) })}</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusColor(status) }]}>
              <Text style={styles.statusBadgeText}>{formatStatus(status)}</Text>
            </View>
          </View>
          <Text style={styles.summaryLine}>
            <Text style={styles.summaryLabel}>{t('deliveryDetails.totalAmountLabel')} </Text>
            <Text style={styles.summaryValue}>{peso(order.total_amount)}</Text>
          </Text>

          <View style={styles.divider} />

          {/* 2. Pickup From — name only, no button here (single Route button lives below) */}
          <Text style={styles.sectionTitle}>{t('deliveryDetails.pickupFromTitle')}</Text>
          <Text style={styles.entityName}>{order.distributor_name}</Text>

          <View style={styles.divider} />

          {/* 3. Deliver To — retailer, address, and preferred delivery as distinct labeled blocks */}
          <Text style={styles.sectionTitle}>{t('deliveryDetails.retailerTitle')}</Text>
          <Text style={styles.subLabel}>{t('deliveryDetails.retailerLabel')}</Text>
          <Text style={styles.entityName}>{order.retailer_name}</Text>
          <Text style={[styles.subLabel, { marginTop: 10 }]}>{t('deliveryDetails.addressLabel')}</Text>
          <Text style={styles.rowMeta}>{order.retailer_address}</Text>
          {scheduleParts && (
            <>
              <Text style={[styles.subLabel, { marginTop: 10 }]}>{t('deliveryDetails.preferredDeliveryLabel')}</Text>
              <Text style={styles.rowMeta}>{scheduleParts.date}</Text>
              <Text style={styles.rowMeta}>{scheduleParts.time}</Text>
            </>
          )}

          <View style={styles.divider} />

          {/* 4. Ordered Vegetables */}
          <Text style={styles.sectionTitle}>{t('deliveryDetails.itemsTitle')}</Text>
          {items.length === 0 ? (
            <Text style={styles.rowMeta}>{t('dashboards.delivery.noItemDetails')}</Text>
          ) : (
            items.map((it, i) => (
              <View key={i} style={styles.itemRow}>
                <Text style={styles.itemName}>{localizeVegetableName(it.vegetable_name, language)}</Text>
                <Text style={styles.itemQty}>{it.quantity_kg} kg</Text>
                <Text style={styles.itemPrice}>{peso(it.price_at_order)}/kg</Text>
              </View>
            ))
          )}

          <View style={styles.divider} />

          {/* 5. Route — the single View Route button, targeting whichever stop is next */}
          <Text style={styles.sectionTitle}>{t('deliveryDetails.routeTitle')}</Text>
          <TouchableOpacity
            style={styles.routeBtnCentered}
            onPress={() => {
              if (!routeTarget.coords) { showAlert(t('common.error'), rank < 1 ? 'Pickup location coordinates are unavailable. Contact the distributor.' : MISSING_DESTINATION_MESSAGE); return; }
              setMapAddress(routeTarget.address || 'Delivery route'); setMapCoords(routeTarget.coords);
            }}
          >
            <Text style={styles.routeBtnText}>{t('dashboards.delivery.viewRoute')}</Text>
          </TouchableOpacity>

          {!finished && (
            <>
              <View style={styles.divider} />

              {/* 6. Delivery Progress */}
              <Text style={styles.sectionTitle}>{t('deliveryDetails.progressTitle')}</Text>
              {locationDetails && <>
                <Text style={styles.rowMeta}>Distance to delivery point: {Math.round(locationDetails.distanceMeters)} m</Text>
                <Text style={styles.rowMeta}>GPS accuracy: ±{Math.round(locationDetails.accuracy)} m</Text>
              </>}
              {!!locationError && <Text style={[styles.rowMeta, { color: colors.danger }]}>{locationError}</Text>}
              <TouchableOpacity style={[styles.routeBtnCentered, busy && styles.buttonDisabled]} disabled={busy} onPress={refreshLocation}>
                <Text style={styles.routeBtnText}>Refresh Location</Text>
              </TouchableOpacity>

              {PROGRESS_STEPS.map((step) => {
                if (rank >= step.rank) {
                  return (
                    <View key={step.key} style={styles.stepDoneRow}>
                      <Ionicons name="checkmark-circle" size={rf(18)} color={PRIMARY} />
                      <Text style={styles.stepDoneText}>{formatStatus(step.key)}</Text>
                    </View>
                  );
                }
                if (rank === step.rank - 1) {
                  return (
                    <TouchableOpacity
                      key={step.key}
                      style={[styles.stepActionBtn, busy && styles.buttonDisabled]}
                      onPress={() => updateStatus(step.key)}
                      disabled={busy}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.stepActionBtnText}>{formatStatus(step.key)}</Text>
                    </TouchableOpacity>
                  );
                }
                return null;
              })}

              <TouchableOpacity
                style={[styles.button, styles.buttonPrimary, (busy || rank < 2) && styles.buttonDisabled]}
                onPress={openProof}
                disabled={busy || rank < 2}
              >
                <Text style={styles.buttonPrimaryText}>{t('dashboards.delivery.markDelivered')}</Text>
              </TouchableOpacity>

              {/* Reject Delivery — only before the rider has started (still just 'assigned'). */}
              {status === 'assigned' && (
                <TouchableOpacity
                  style={[styles.rejectBtn, busy && styles.buttonDisabled]}
                  onPress={openRejectModal}
                  disabled={busy}
                  activeOpacity={0.8}
                >
                  <Text style={styles.rejectBtnText}>{t('dashboards.delivery.rejectDeliveryBtn')}</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </ScrollView>

      <DeliveryMapModal
        visible={!!mapAddress}
        address={mapAddress}
        coords={mapCoords}
        onClose={() => { setMapAddress(null); setMapCoords(null); }}
      />

      <ProofPreviewModal
        visible={confirmVisible}
        orderLabel={`#${shortId(order.id)}`}
        photo={photo}
        busy={busy}
        onPickPhoto={pickPhoto}
        onConfirm={markDelivered}
        onCancel={() => setConfirmVisible(false)}
      />

      <CustomModal
        visible={rejectModalVisible}
        title={t('dashboards.delivery.rejectDeliveryModalTitle')}
        confirmLabel={rejecting ? t('dashboards.delivery.rejecting') : t('dashboards.delivery.rejectDeliveryBtn')}
        onConfirm={submitReject}
        cancelLabel={t('common.cancel')}
        onCancel={() => setRejectModalVisible(false)}
        busy={rejecting}
        confirmDisabled={!rejectReasonKey || (rejectReasonKey === 'other' && !rejectOtherText.trim())}
      >
        <View style={styles.reasonWrap}>
          {REJECT_REASON_PRESETS.map((r) => {
            const selected = rejectReasonKey === r.key;
            return (
              <TouchableOpacity
                key={r.key}
                style={[styles.reasonChip, selected && styles.reasonChipActive]}
                onPress={() => setRejectReasonKey(r.key)}
              >
                <Text style={[styles.reasonChipText, selected && styles.reasonChipTextActive]}>{r.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {rejectReasonKey === 'other' && (
          <TextInput
            style={styles.reasonInput}
            value={rejectOtherText}
            onChangeText={setRejectOtherText}
            placeholder={t('dashboards.delivery.rejectReasonOtherPlaceholder')}
            placeholderTextColor={colors.inkFaint}
            multiline
          />
        )}
      </CustomModal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  back: { color: PRIMARY, fontSize: rf(16), fontFamily: fonts.bodySemiBold, width: 50 },
  title: { fontSize: rf(19), fontFamily: fonts.heading, color: colors.ink },
  content: { padding: 16, paddingBottom: 40, flexGrow: 1 },

  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  orderId: { fontFamily: fonts.bodyBold, fontSize: rf(16), color: colors.ink },
  statusBadge: { paddingVertical: 3, paddingHorizontal: 10, borderRadius: 12 },
  statusBadgeText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(12) },

  summaryLine: { fontSize: rf(14), marginTop: 4 },
  summaryLabel: { fontFamily: fonts.body, color: colors.inkSoft },
  summaryValue: { fontFamily: fonts.bodyBold, color: PRIMARY },

  divider: { height: 1, backgroundColor: colors.border, marginVertical: 14 },

  sectionTitle: { fontFamily: fonts.heading, fontSize: rf(15), color: colors.ink, marginBottom: 8 },
  entityName: { fontFamily: fonts.bodyBold, fontSize: rf(14.5), color: colors.ink, marginBottom: 2 },
  subLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(11), color: colors.inkFaint, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 },
  rowMeta: { fontFamily: fonts.body, fontSize: rf(13.5), color: colors.inkSoft, marginTop: 2 },
  routeBtnCentered: { alignSelf: 'center', marginTop: 4, paddingVertical: 10, paddingHorizontal: 28, borderRadius: radius.ctrl, borderWidth: 1.4, borderColor: PRIMARY },
  routeBtnText: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: rf(14) },

  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  itemName: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: rf(14), color: colors.ink, textTransform: 'capitalize' },
  itemQty: { fontFamily: fonts.body, fontSize: rf(13), color: colors.inkSoft, marginRight: 10 },
  itemPrice: { fontFamily: fonts.body, fontSize: rf(13), color: colors.inkSoft },

  // Delivery Progress: completed steps render as an indicator row (no action),
  // the single next step renders as the actionable button below it.
  stepDoneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  stepDoneText: { fontFamily: fonts.bodySemiBold, fontSize: rf(14), color: PRIMARY },
  stepActionBtn: { paddingVertical: 12, borderRadius: radius.ctrl, alignItems: 'center', borderWidth: 1.5, borderColor: PRIMARY, backgroundColor: colors.card, marginBottom: 8 },
  stepActionBtnText: { fontFamily: fonts.bodyBold, color: PRIMARY, fontSize: rf(14) },

  button: { paddingVertical: 14, borderRadius: radius.ctrl, alignItems: 'center', marginTop: 4 },
  buttonPrimary: { backgroundColor: PRIMARY },
  buttonPrimaryText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(15.5) },
  buttonDisabled: { opacity: 0.6 },

  rejectBtn: { paddingVertical: 11, borderRadius: radius.ctrl, alignItems: 'center', marginTop: 10, borderWidth: 1.5, borderColor: colors.danger },
  rejectBtnText: { fontFamily: fonts.bodyBold, color: colors.danger, fontSize: rf(13.5) },

  reasonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reasonChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  reasonChipActive: { backgroundColor: colors.danger, borderColor: colors.danger },
  reasonChipText: { fontFamily: fonts.body, color: colors.inkSoft, fontSize: rf(13) },
  reasonChipTextActive: { color: '#fff', fontFamily: fonts.bodySemiBold },
  reasonInput: { marginTop: 10, borderWidth: 1, borderColor: colors.border, borderRadius: radius.ctrl, padding: 10, fontFamily: fonts.body, fontSize: rf(14), color: colors.ink, minHeight: 70, textAlignVertical: 'top' },
});
