import useRequestLock from '../hooks/useRequestLock';
import { clearCheckedOutCart } from '../lib/cartStore';
import { manilaDate, scheduleInstant, validateSchedule } from '../lib/deliverySchedule';
import { rf } from '../lib/responsive';
import { useState, useEffect } from 'react';
import {
  Text, View, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/useTranslation';
import { showAlert, peso } from '../lib/ui';
import { friendlyError } from '../lib/errorMessages';
import { getVegetableTile } from '../lib/vegetableIcons';
import VegetableImage from '../components/VegetableImage';
import { localizeVegetableName } from '../lib/vegetableNames';
import DeliveryDateTimeFields from '../components/DeliveryDateTimeFields';
import CustomModal from '../components/CustomModal';
import { colors, fonts, fontSize, radius, shadowCard } from '../theme/appTheme';
import ScreenHeader from '../components/ScreenHeader';
import StatusBadge from '../components/ui/StatusBadge';

const PRIMARY = colors.leaf700;

export default function OrderConfirmationScreen({ navigation, route }) {
  const requestLock = useRequestLock();
  const { user } = useAuth();
  const { t, language } = useTranslation();
  const { cart = [], totalItems = 0, totalAmount = 0, defaultAddress = '' } = route.params || {};
  // Address state
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [selectedAddressId, setSelectedAddressId] = useState(null);
  const [address, setAddress] = useState(defaultAddress || user?.store_location || '');
  const [latitude, setLatitude] = useState(null);
  const [longitude, setLongitude] = useState(null);
  
  const [date, setDate] = useState(manilaDate());
  const [time, setTime] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const scheduleValid = scheduleInstant(`${date}T${time}`) > now;
  const [confirming, setConfirming] = useState(false);
  const [success, setSuccess] = useState(false);

  // Load saved addresses
  useEffect(() => {
    loadAddresses();
    return navigation.addListener('focus', loadAddresses);
  }, [navigation]);

  const loadAddresses = async () => {
    try {
      const data = await api.get('/api/addresses');
      setSavedAddresses(data || []);
      const preferredAddress = data?.find(a => a.is_default) || data?.[0];
      if (preferredAddress) {
        setSelectedAddressId(preferredAddress.id);
        setAddress(preferredAddress.address);
        setLatitude(preferredAddress.latitude ?? null);
        setLongitude(preferredAddress.longitude ?? null);
      }
    } catch (err) {
      console.error('Load addresses error:', err);
    } finally {
      setLoadingAddresses(false);
    }
  };

  const handleSelectAddress = (addr) => {
    setSelectedAddressId(addr.id);
    setAddress(addr.address);
    setLatitude(addr.latitude ?? null);
    setLongitude(addr.longitude ?? null);
  };

  const getFinalAddress = () => {
    const selected = savedAddresses.find(a => a.id === selectedAddressId);
    return selected?.address || '';
  };

  const weightValid = cart.length > 0 && cart.every(c => Number.isFinite(c.quantity) && c.quantity > 0) && cart.reduce((sum, c) => sum + c.quantity, 0) >= 5;
  const canConfirm = weightValid && !!getFinalAddress().trim() && scheduleValid && latitude != null && longitude != null;

  const confirmOrder = async () => {
    if (confirming || success) return;
    if (!weightValid) { showAlert(t('common.error'), t('checkout.minimumWeight')); return; }
    const finalAddress = getFinalAddress();
    if (!finalAddress.trim()) {
      showAlert(t('common.error'), t('dashboards.retailer.addressRequired'));
      return;
    }

    try { validateSchedule(`${date}T${time}`); } catch (err) { showAlert(t('common.error'), t('pod.pastSchedule')); return; }
    const payload = {
      items: cart.map((c) => ({ vegetable_name: c.vegetable_name, quantity_kg: c.quantity })),
      delivery_address: finalAddress.trim(),
      delivery_latitude: latitude,
      delivery_longitude: longitude,
      preferred_schedule: `${date}T${time}+08:00`,
    };

    if (!requestLock.acquire('Confirming')) return;

    setConfirming(true);
    try {
      await api.post('/api/orders', payload);
      await clearCheckedOutCart(user.id).catch(() => showAlert(t('common.error'), t('checkout.cartStorageError')));
      setSuccess(true);
    } catch (err) {
      const code = err?.code || err?.data?.code;
      const message = err?.status === 401
        ? 'Your session has ended. Please sign in again.'
        : !err?.status
          ? (err?.message === 'insufficient stock' ? 'Some items just ran out of stock. Please check your cart and try again.' : 'Please check your internet connection and try again.')
          : code === 'ADDRESS_LOCATION_REQUIRED'
            ? 'This address needs a map pin. Please open Manage Addresses and set it on the map.'
            : err?.data?.field === 'preferred_schedule'
              ? 'That delivery time is no longer available. Please pick another one.'
              : friendlyError(err, 'We couldn’t place your order. Please try again.');
      showAlert(t('dashboards.retailer.orderFailedTitle'), message);
    } finally {
      requestLock.release('Confirming');
      setConfirming(false);
    }
  };

  const goHome = () => {
    setSuccess(false);
    navigation.navigate('RetailerDashboard', { tab: 'shop', orderPlaced: true });
  };

  const selectedAddress = savedAddresses.find(a => a.id === selectedAddressId);

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title={t('dashboards.retailer.checkoutTitle')} onBack={() => { if (!confirming) navigation.goBack(); }} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Order Summary */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('dashboards.retailer.orderSummary')}</Text>
          {cart.map((c) => {
            const tile = getVegetableTile(c.vegetable_name);
            return (
              <View key={c.vegetable_name} style={styles.itemRow}>
                <View style={[styles.itemTile, { backgroundColor: tile.bg }]}>
                  <VegetableImage source={tile.source} style={styles.itemTileIcon} fallbackSize={rf(18)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{localizeVegetableName(c.name, language)}</Text>
                  <Text style={styles.itemMeta}>{c.quantity} kg × {peso(c.price)}</Text>
                </View>
                <Text style={styles.itemSubtotal}>{peso(c.price * c.quantity)}</Text>
              </View>
            );
          })}

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{t('dashboards.retailer.totalAmount', { qty: totalItems })}</Text>
            <Text style={styles.summaryTotal}>{peso(totalAmount)}</Text>
          </View>
        </View>

        {/* Delivery Address Selection */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('dashboards.retailer.deliveryAddressLabel')}</Text>

          {loadingAddresses ? (
            <ActivityIndicator size="small" color={PRIMARY} style={{ marginVertical: 10 }} />
          ) : savedAddresses.length > 0 ? (
            <>
              {savedAddresses.map((addr) => (
                <TouchableOpacity
                  key={addr.id}
                  style={[
                    styles.addressOption,
                    selectedAddressId === addr.id && styles.addressOptionSelected,
                  ]}
                  onPress={() => handleSelectAddress(addr)}
                  disabled={confirming}
                >
                  <View style={styles.addressRadio}>
                    {selectedAddressId === addr.id && <View style={styles.addressRadioSelected} />}
                  </View>
                  <View style={styles.addressInfo}>
                    <Text style={styles.addressLabel}>{addr.label}</Text>
                    <Text style={styles.addressText} numberOfLines={2}>{addr.address}</Text>
                    {addr.is_default && <View style={{ marginTop: 4, alignSelf: 'flex-start' }}><StatusBadge status="active" label="Default" /></View>}
                  </View>
                </TouchableOpacity>
              ))}

            </>
          ) : (
            <Text style={styles.noAddressesText}>No saved delivery address. Add one before placing your order.</Text>
          )}

          <TouchableOpacity style={styles.manageAddressesLink} onPress={() => navigation.navigate('ManageAddresses')} disabled={confirming}>
            <Text style={styles.manageAddressesLinkText}>Manage Address</Text>
          </TouchableOpacity>
        </View>

        {/* Preferred Schedule */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('dashboards.retailer.preferredTimeLabel')}</Text>
          <DeliveryDateTimeFields date={date} onDateChange={setDate} time={time} onTimeChange={setTime} disabled={confirming} />
          {!!date && !!time && !scheduleValid && <Text style={{ color: colors.danger }}>{t('pod.pastSchedule')}</Text>}
          {(latitude == null || longitude == null) && <Text style={{ color: colors.danger }}>Choose a saved address with a map location, or update it in Manage Address.</Text>}
        </View>

        {!weightValid && <Text style={{ color: colors.danger }}>{t('checkout.minimumWeight')}</Text>}
        {/* Confirm Button */}
        <TouchableOpacity
          style={[styles.button, styles.buttonPrimary, (confirming || !canConfirm) && styles.buttonDisabled]}
          onPress={confirmOrder}
          disabled={confirming || !canConfirm}
        >
          {confirming
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonPrimaryText}>{t('dashboards.retailer.confirmOrder')}</Text>}
        </TouchableOpacity>
      </ScrollView>

      <CustomModal
        visible={success}
        title={t('dashboards.retailer.orderCompletedTitle')}
        confirmLabel={t('dashboards.retailer.goBackHome')}
        onConfirm={goHome}
      >
        <View style={styles.successBody}>
          <Ionicons name="checkmark-circle" size={rf(64)} color={PRIMARY} />
          <Text style={styles.successMessage}>{t('dashboards.retailer.orderCompletedMessage')}</Text>
        </View>
      </CustomModal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  title: { fontFamily: fonts.heading, fontSize: rf(18), color: colors.ink },
  content: { padding: 16, paddingBottom: 40 },

  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadowCard,
  },
  sectionTitle: { fontFamily: fonts.heading, fontSize: rf(fontSize.lg), color: colors.ink, marginBottom: 12 },

  // Address selection styles
  addressOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.ctrl,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
    backgroundColor: colors.bgScreen,
  },
  addressOptionSelected: {
    borderColor: PRIMARY,
    backgroundColor: colors.leaf50,
  },
  addressRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addressRadioSelected: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: PRIMARY,
  },
  addressInfo: { flex: 1 },
  addressLabel: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.md), color: colors.ink },
  addressText: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginTop: 2 },
  noAddressesText: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.inkSoft, marginVertical: 8 },
  manualAddressContainer: { marginTop: 8 },
  addressRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  input: {
    backgroundColor: '#fff',
    borderRadius: radius.ctrl,
    padding: 12,
    fontFamily: fonts.body,
    fontSize: rf(fontSize.md),
    color: colors.ink,
    borderWidth: 1.4,
    borderColor: colors.border,
  },
  pinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: PRIMARY,
    borderRadius: radius.ctrl,
  },
  pinBtnText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(fontSize.sm), textAlign: 'center' },
  manageAddressesLink: { marginTop: 8 },
  manageAddressesLinkText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: PRIMARY },

  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  itemTile: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  itemTileIcon: { width: 28, height: 28 },
  itemName: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.md), color: colors.ink, textTransform: 'capitalize' },
  itemMeta: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginTop: 1 },
  itemSubtotal: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: colors.ink },

  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, marginTop: 4, borderTopWidth: 1, borderTopColor: colors.border },
  summaryLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.lg), color: colors.ink },
  summaryTotal: { fontFamily: fonts.heading, fontSize: rf(fontSize.title), color: PRIMARY },

  button: { paddingVertical: 14, borderRadius: radius.ctrl, alignItems: 'center' },
  buttonPrimary: { backgroundColor: PRIMARY },
  buttonPrimaryText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(fontSize.lg) },
  buttonDisabled: { opacity: 0.6 },

  successBody: { alignItems: 'center', paddingVertical: 8 },
  successMessage: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.inkSoft, textAlign: 'center', marginTop: 12 },
});
