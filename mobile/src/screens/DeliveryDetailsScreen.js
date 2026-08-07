import { useState } from 'react';
import { Text, View, ScrollView, TouchableOpacity, TextInput, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import api from '../api/client';
import { uploadToCloudinary } from '../lib/cloudinary';
import DeliveryMapModal from '../components/DeliveryMapModal';
import ProofPreviewModal from '../components/ProofPreviewModal';
import CustomModal from '../components/CustomModal';
import { showAlert, peso, shortId } from '../lib/ui';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { statusColor, formatStatus, getDelivery, effectiveStatus, STATUS_RANK } from './DeliveryDashboard';
import { rf } from '../lib/responsive';
import { localizeVegetableName } from '../lib/vegetableNames';

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
    date: d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }),
    time: d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
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

  const refreshOrder = async () => {
    try {
      const list = await api.get('/api/delivery/orders');
      const updated = (Array.isArray(list) ? list : []).find((o) => o.id === order.id);
      if (updated) setOrder(updated);
    } catch {
      // keep showing the last known state
    }
  };

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
    : { address: order.retailer_address, coords: order.retailer_coords };

  const updateStatus = async (newStatus) => {
    if (!delivery?.id) {
      showAlert(t('dashboards.delivery.missingDeliveryTitle'), t('dashboards.delivery.pullToRefreshRetry'));
      return;
    }
    setBusy(true);
    try {
      await api.put(`/api/deliveries/${delivery.id}/status`, { status: newStatus });
      await refreshOrder();
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      setBusy(false);
    }
  };

  const pickPhoto = async () => {
    try {
      let result;
      if (Platform.OS === 'web') {
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.6 });
      } else {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          showAlert(t('dashboards.delivery.permissionNeededTitle'), t('dashboards.delivery.cameraPermissionMessage'));
          return;
        }
        result = await ImagePicker.launchCameraAsync({ quality: 0.6 });
      }
      if (!result.canceled && result.assets?.length) setPhoto(result.assets[0]);
    } catch (err) {
      showAlert(t('common.error'), err.message || t('dashboards.delivery.cameraErrorFallback'));
    }
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
    setRejecting(true);
    try {
      await api.put(`/api/deliveries/${delivery.id}/reject`, { reason });
      setRejectModalVisible(false);
      showAlert(t('dashboards.delivery.rejectedTitle'), t('dashboards.delivery.rejectedMessage', { id: shortId(order.id) }));
      // The order is no longer assigned to this rider — nothing left to show here.
      navigation.goBack();
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      setRejecting(false);
    }
  };

  const markDelivered = async () => {
    if (!delivery?.id) {
      showAlert(t('dashboards.delivery.missingDeliveryTitle'), t('dashboards.delivery.missingDeliveryIdMessage'));
      return;
    }
    setBusy(true);
    try {
      let proofUrl;
      if (photo) proofUrl = await uploadToCloudinary(photo);
      await api.put(`/api/deliveries/${delivery.id}/complete`, proofUrl ? { proof_photo_url: proofUrl } : {});
      setPhoto(null);
      setConfirmVisible(false);
      await refreshOrder();
      showAlert(t('dashboards.delivery.deliveredTitle'), t('dashboards.delivery.deliveredMessage', { id: shortId(order.id) }));
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
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
          {!finished && (
            <Text style={styles.summaryLine}>{t('dashboards.delivery.etaText')}</Text>
          )}

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
            onPress={() => { setMapAddress(routeTarget.address); setMapCoords(routeTarget.coords); }}
          >
            <Text style={styles.routeBtnText}>{t('dashboards.delivery.viewRoute')}</Text>
          </TouchableOpacity>

          {!finished && (
            <>
              <View style={styles.divider} />

              {/* 6. Delivery Progress */}
              <Text style={styles.sectionTitle}>{t('deliveryDetails.progressTitle')}</Text>

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
                onPress={() => setConfirmVisible(true)}
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
