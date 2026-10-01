import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import TextInput from '../AppTextInput';
import api from '../../api/client';
import CustomModal from '../CustomModal';
import EmptyState from '../EmptyState';
import RemoteImage from '../RemoteImage';
import UserAvatar from '../UserAvatar';
import { SegmentedTabs } from '../ui/SegmentedTabs';
import StatusBadge from '../ui/StatusBadge';
import useRequestLock from '../../hooks/useRequestLock';
import { rf } from '../../lib/responsive';
import { showAlert, peso, shortId } from '../../lib/ui';
import { friendlyError } from '../../lib/errorMessages';
import { localizeVegetableName } from '../../lib/vegetableNames';
import { PICKUP_TABS, pickupTabOf, pickupBadge } from '../../lib/pickupStatus';
import { useTranslation } from '../../i18n/useTranslation';
import {
  colors, fontSize, fonts, radius, shadowCard, spacing, actionBtn, actionBtnOutline, actionBtnPrimary, actionBtnDanger, actionBtnText,
} from '../../theme/appTheme';

const PRIMARY = colors.leaf700;
const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};
const kg = (value) => (value != null ? `${Number(value)} kg` : '—');

export function PickupBadge({ status }) {
  const { t } = useTranslation();
  const badge = pickupBadge(status);
  return <StatusBadge status={badge.tone} label={badge.labelKey ? t(badge.labelKey) : undefined} />;
}

function DetailRow({ label, value, children }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      {children || <Text style={styles.detailValue} selectable>{value}</Text>}
    </View>
  );
}

/**
 * Distributor Home > Pickup Requests. Farmer requests move Pending -> Approved ->
 * Ready for Pickup -> In Progress -> Picked Up, or to Declined. Completed and
 * declined requests stay as history. `onChanged` reloads the list after an action.
 */
export default function PickupRequestsPanel({ loading, requests = [], personnel = [], onChanged, onViewProof }) {
  const { t, language } = useTranslation();
  const requestLock = useRequestLock();
  const [tab, setTab] = useState('pending');
  const [approving, setApproving] = useState(null); // { request, mode: 'approve' | 'assign' }
  const [riderId, setRiderId] = useState(null);
  const [declining, setDeclining] = useState(null);
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />;

  const groups = Object.fromEntries(PICKUP_TABS.map((key) => [key, []]));
  requests.forEach((request) => groups[pickupTabOf(request.status)].push(request));
  const shown = groups[tab];
  const vegetable = (r) => (r.harvests?.vegetable_name ? localizeVegetableName(r.harvests.vegetable_name, language) : t('dashboards.distributor.unknownHarvest'));

  const run = async (key, action, success) => {
    if (!requestLock.acquire(key)) return false;
    setBusy(true);
    try {
      await action();
      await onChanged?.();
      if (success) showAlert(success.title, success.message);
      return true;
    } catch (err) {
      showAlert(t('common.error'), friendlyError(err));
      await onChanged?.();
      return false;
    } finally {
      requestLock.release(key);
      setBusy(false);
    }
  };

  const confirmApprove = async () => {
    const { request, mode } = approving;
    if (mode === 'assign' && !riderId) { showAlert(t('common.checkDetails'), t('dashboards.distributor.selectRider')); return; }
    const done = await run('approvePickup', () => (riderId
      ? api.put(`/api/pickup-requests/${request.id}/assign`, { delivery_personnel_id: riderId })
      : api.put(`/api/pickup-requests/${request.id}/approve`)),
    riderId
      ? { title: t('dashboards.distributor.riderAssignedTitle'), message: t('dashboards.distributor.riderAssignedMessage') }
      : { title: t('pickupPanel.approvedTitle'), message: t('pickupPanel.approvedMessage') });
    if (done) { setApproving(null); setTab('active'); }
  };

  const confirmDecline = async () => {
    if (!reason.trim()) return;
    const done = await run('declinePickup', () => api.put(`/api/pickup-requests/${declining.id}/decline`, { reason: reason.trim() }),
      { title: t('pickupPanel.declinedTitle'), message: t('pickupPanel.declinedMessage') });
    if (done) { setDeclining(null); setReason(''); }
  };

  const renderCard = (r) => (
    <View key={r.id} style={styles.card}>
      <View style={styles.cardHead}>
        <UserAvatar user={{ full_name: r.farmer_name, avatar_url: r.farmer_avatar_url }} size={28} />
        <Text style={styles.farmer} numberOfLines={1}>{r.farmer_name || t('dashboards.delivery.farmerFallback')}</Text>
        <PickupBadge status={r.status} />
      </View>
      <Text style={styles.vegetable}>{vegetable(r)} · {kg(r.quantity_kg)}</Text>
      <View style={styles.priceRow}>
        <Text style={styles.priceText}>{r.price_per_kg != null ? t('pickupPanel.pricePerKg', { price: peso(r.price_per_kg) }) : t('pickupPanel.noPrice')}</Text>
        {r.estimated_total != null && <Text style={styles.totalText}>{t('pickupPanel.totalShort', { total: peso(r.estimated_total) })}</Text>}
      </View>
      <Text style={styles.meta}>{t('pickupPanel.harvestedOn', { date: formatDate(r.harvest_date) })} · {t('pickupPanel.requestedOn', { date: formatDate(r.requested_at || r.created_at) })}</Text>
      {['assigned', 'otw', 'picked_up'].includes(r.status) && !!r.rider_name && (
        <Text style={styles.meta}>{t('dashboards.distributor.riderLabel', { name: r.rider_name })}</Text>
      )}
      {r.status === 'declined' && !!r.decline_reason && <Text style={styles.meta}>{t('pickupPanel.reason', { reason: r.decline_reason })}</Text>}

      <View style={styles.actions}>
        {r.status === 'requested' && (
          <>
            <TouchableOpacity style={[styles.btn, styles.btnPrimary, busy && styles.disabled]} disabled={busy}
              onPress={() => { setApproving({ request: r, mode: 'approve' }); setRiderId(null); }}>
              <Text style={styles.btnPrimaryText}>{t('dashboards.distributor.approve')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnDanger, busy && styles.disabled]} disabled={busy}
              onPress={() => { setDeclining(r); setReason(''); }}>
              <Text style={styles.btnDangerText}>{t('pickupPanel.decline')}</Text>
            </TouchableOpacity>
          </>
        )}
        {r.status === 'approved' && (
          <>
            <TouchableOpacity style={[styles.btn, styles.btnPrimary, busy && styles.disabled]} disabled={busy}
              onPress={() => { setApproving({ request: r, mode: 'assign' }); setRiderId(null); }}>
              <Text style={styles.btnPrimaryText}>{t('pickupPanel.assignRider')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnDanger, busy && styles.disabled]} disabled={busy}
              onPress={() => { setDeclining(r); setReason(''); }}>
              <Text style={styles.btnDangerText}>{t('pickupPanel.decline')}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
      <TouchableOpacity style={styles.detailsBtn} onPress={() => setDetail(r)} accessibilityRole="button">
        <Text style={styles.detailsBtnText}>{t('inventoryReport.viewDetails')}</Text>
      </TouchableOpacity>
    </View>
  );

  const summary = (r) => (
    <View style={styles.summary}>
      <DetailRow label={t('pickupPanel.farmer')} value={r.farmer_name || '—'} />
      <DetailRow label={t('pickupPanel.vegetable')} value={vegetable(r)} />
      <DetailRow label={t('pickupPanel.quantity')} value={kg(r.quantity_kg)} />
      <DetailRow label={t('pickupPanel.farmerPrice')} value={r.price_per_kg != null ? `${peso(r.price_per_kg)} / kg` : '—'} />
      <DetailRow label={t('pickupPanel.estimatedTotal')} value={r.estimated_total != null ? peso(r.estimated_total) : '—'} />
    </View>
  );

  return (
    <View>
      <SegmentedTabs scroll inset={spacing.lg} style={styles.tabsBleed} value={tab} onChange={setTab}
        options={PICKUP_TABS.map((key) => ({ value: key, label: t(`pickupPanel.tabs.${key}`), count: key === 'pending' ? groups.pending.length : 0 }))} />
      {shown.length === 0 ? (
        <EmptyState iconElement={<MaterialCommunityIcons name="tractor" size={rf(44)} color={colors.inkFaint} />}
          title={t(`pickupPanel.empty.${tab}`)} message={t('pickupPanel.emptyMessage')} />
      ) : shown.map(renderCard)}

      <CustomModal
        visible={!!approving}
        title={approving?.mode === 'assign' ? t('pickupPanel.assignTitle') : t('pickupPanel.approveTitle')}
        confirmLabel={approving?.mode === 'approve' && riderId ? t('pickupPanel.approveAndAssign')
          : approving?.mode === 'approve' ? t('dashboards.distributor.approve') : t('pickupPanel.assignRider')}
        onConfirm={confirmApprove}
        cancelLabel={t('common.cancel')}
        onCancel={() => setApproving(null)}
        busy={busy}
        confirmDisabled={approving?.mode === 'assign' && !riderId}
      >
        {!!approving && (
          <>
            {summary(approving.request)}
            <Text style={styles.fieldLabel}>
              {approving.mode === 'approve' ? t('pickupPanel.riderOptional') : t('dashboards.distributor.assignPersonnelLabel')}
            </Text>
            {personnel.length === 0 ? (
              <Text style={styles.hint}>{t('dashboards.distributor.noPersonnelAvailable')}</Text>
            ) : (
              <View style={styles.chips}>
                {personnel.map((person) => {
                  const selected = riderId === person.id;
                  return (
                    <TouchableOpacity key={person.id} style={[styles.chip, selected && styles.chipActive]} disabled={busy}
                      onPress={() => setRiderId(selected && approving.mode === 'approve' ? null : person.id)}>
                      <Text style={[styles.chipText, selected && styles.chipTextActive]}>{person.full_name || shortId(person.id)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </>
        )}
      </CustomModal>

      <CustomModal
        visible={!!declining}
        title={t('pickupPanel.declineTitle')}
        confirmLabel={t('pickupPanel.decline')}
        onConfirm={confirmDecline}
        cancelLabel={t('common.cancel')}
        onCancel={() => setDeclining(null)}
        busy={busy}
        confirmDisabled={!reason.trim()}
        danger
      >
        {!!declining && (
          <>
            {summary(declining)}
            <Text style={styles.fieldLabel}>{t('pickupPanel.declineReasonLabel')}</Text>
            <TextInput style={styles.input} value={reason} onChangeText={setReason} multiline maxLength={300}
              placeholder={t('pickupPanel.declineReasonPlaceholder')} placeholderTextColor={colors.placeholder} />
          </>
        )}
      </CustomModal>

      <CustomModal visible={!!detail} title={detail ? t('cmp.pickupNo', { id: shortId(detail.id) }) : ''} onCancel={() => setDetail(null)} compactActions>
        {!!detail && (
          <>
            <View style={styles.detailStatusRow}>
              <Text style={styles.detailLabel}>{t('pickupPanel.status')}</Text>
              <PickupBadge status={detail.status} />
            </View>
            <DetailRow label={t('pickupPanel.farmer')} value={detail.farmer_name || '—'} />
            <DetailRow label={t('pickupPanel.vegetable')} value={vegetable(detail)} />
            <DetailRow label={t('pickupPanel.batch')} value={detail.batch_id || t('pickupPanel.noBatchYet')} />
            <DetailRow label={t('pickupPanel.harvestDate')} value={formatDate(detail.harvest_date)} />
            <DetailRow label={t('pickupPanel.quantity')} value={kg(detail.quantity_kg)} />
            <DetailRow label={t('pickupPanel.farmerPrice')} value={detail.price_per_kg != null ? `${peso(detail.price_per_kg)} / kg` : '—'} />
            <DetailRow label={t('pickupPanel.estimatedTotal')} value={detail.estimated_total != null ? peso(detail.estimated_total) : '—'} />
            <DetailRow label={t('pickupPanel.pickupLocation')} value={detail.pickup_location || '—'} />
            <DetailRow label={t('pickupPanel.requestDate')} value={formatDate(detail.requested_at || detail.created_at)} />
            {!!detail.approved_at && <DetailRow label={t('pickupPanel.approvedDate')} value={formatDate(detail.approved_at)} />}
            <DetailRow label={t('pickupPanel.rider')} value={detail.rider_name || '—'} />
            {detail.status === 'picked_up' && <DetailRow label={t('pickupPanel.pickedUpDate')} value={formatDate(detail.received_at)} />}
            {detail.status === 'declined' && <DetailRow label={t('pickupPanel.declineReasonLabel')} value={detail.decline_reason || '—'} />}
            {!!detail.note && <DetailRow label={t('pickupPanel.note')} value={detail.note} />}
            {!!detail.proof_photo_url && (
              <TouchableOpacity style={styles.proofRow} onPress={() => { onViewProof?.(detail); setDetail(null); }} accessibilityRole="button">
                <RemoteImage uri={detail.proof_photo_url} style={styles.proofThumb} />
                <Text style={styles.proofText}>{t('pickupPanel.pickupProof')}</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </CustomModal>
    </View>
  );
}

const styles = StyleSheet.create({
  tabsBleed: { marginHorizontal: -spacing.lg, marginBottom: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  farmer: { flex: 1, minWidth: 0, fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg), color: colors.ink },
  vegetable: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: PRIMARY, marginTop: 8 },
  priceRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6, marginTop: 4 },
  priceText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: colors.ink },
  totalText: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.md), color: PRIMARY },
  meta: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginTop: 4 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: 12 },
  btn: { ...actionBtn, flex: 1, minHeight: 40 },
  btnPrimary: actionBtnPrimary,
  btnPrimaryText: { ...actionBtnText, color: '#fff' },
  btnDanger: actionBtnDanger,
  btnDangerText: { ...actionBtnText, color: colors.danger },
  disabled: { opacity: 0.6 },
  detailsBtn: { ...actionBtn, ...actionBtnOutline, marginTop: 10 },
  detailsBtnText: { ...actionBtnText, color: PRIMARY },
  summary: { marginBottom: 12, borderRadius: radius.ctrl, backgroundColor: colors.bgScreen, paddingHorizontal: 12 },
  fieldLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.ink, marginBottom: 6 },
  hint: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.ctrl, padding: 10, minHeight: 80, textAlignVertical: 'top', fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.ink, backgroundColor: colors.card },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgScreen },
  chipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  chipText: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft },
  chipTextActive: { fontFamily: fonts.bodySemiBold, color: '#fff' },
  detailStatusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  detailRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, alignItems: 'flex-start' },
  detailLabel: { fontFamily: fonts.body, fontSize: rf(fontSize.xs), color: colors.inkFaint },
  detailValue: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: colors.ink, marginTop: 2 },
  proofRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  proofThumb: { width: 56, height: 56, borderRadius: radius.ctrl, backgroundColor: colors.leaf50 },
  proofText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: PRIMARY },
});
