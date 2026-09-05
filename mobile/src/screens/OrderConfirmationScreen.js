import { rf } from '../lib/responsive';
import { useState, useEffect } from 'react';
import {
  Text, View, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/useTranslation';
import { showAlert, peso } from '../lib/ui';
import { getVegetableTile } from '../lib/vegetableIcons';
import { localizeVegetableName } from '../lib/vegetableNames';
import DeliveryDateTimeFields from '../components/DeliveryDateTimeFields';
import MapPinningModal from '../components/MapPinningModal';
import CustomModal from '../components/CustomModal';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';

const PRIMARY = colors.leaf700;

const pad = (n) => String(n).padStart(2, '0');
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export default function OrderConfirmationScreen({ navigation, route }) {
  const { user } = useAuth();
  const { t, language } = useTranslation();
  const { cart = [], totalItems = 0, totalAmount = 0, defaultAddress = '' } = route.params || {};

  // Address state
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [selectedAddressId, setSelectedAddressId] = useState(null);
  const [useManualAddress, setUseManualAddress] = useState(false);
  const [address, setAddress] = useState(defaultAddress || user?.store_location || '');
  const [latitude, setLatitude] = useState(null);
  const [longitude, setLongitude] = useState(null);
  const [mapModalVisible, setMapModalVisible] = useState(false);
  
  const [date, setDate] = useState(todayKey());
  const [time, setTime] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [success, setSuccess] = useState(false);

  // Load saved addresses
  useEffect(() => {
    loadAddresses();
  }, []);

  const loadAddresses = async () => {
    try {
      const data = await api.get('/api/addresses');
      setSavedAddresses(data || []);
      const defaultAddr = data?.find(a => a.is_default);
      if (defaultAddr) {
        setSelectedAddressId(defaultAddr.id);
        setAddress(defaultAddr.address);
        setLatitude(defaultAddr.latitude || null);
        setLongitude(defaultAddr.longitude || null);
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
    setLatitude(addr.latitude || null);
    setLongitude(addr.longitude || null);
    setUseManualAddress(false);
  };

  const handleUseManual = () => {
    setUseManualAddress(true);
    setSelectedAddressId(null);
    setAddress('');
    setLatitude(null);
    setLongitude(null);
  };

  const handleMapConfirm = ({ latitude: lat, longitude: lng, address: addr }) => {
    setLatitude(lat);
    setLongitude(lng);
    setAddress(addr);
    setUseManualAddress(true);
    setSelectedAddressId(null);
    setMapModalVisible(false);
  };

  const getFinalAddress = () => {
    if (useManualAddress) return address;
    const selected = savedAddresses.find(a => a.id === selectedAddressId);
    return selected?.address || address;
  };

  const canConfirm = !!getFinalAddress().trim() && !!date && !!time;

  const confirmOrder = async () => {
    const finalAddress = getFinalAddress();
    if (!finalAddress.trim()) {
      showAlert(t('common.error'), t('dashboards.retailer.addressRequired'));
      return;
    }

    const payload = {
      items: cart.map((c) => ({ vegetable_name: c.vegetable_name, quantity_kg: c.quantity })),
      delivery_address: finalAddress.trim(),
      preferred_schedule: `${date}T${time}`,
    };

    setConfirming(true);
    try {
      await api.post('/api/orders', payload);
      setSuccess(true);
    } catch (err) {
      showAlert(t('dashboards.retailer.orderFailedTitle'), err?.message || t('dashboards.retailer.orderFailedFallback'));
    } finally {
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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} disabled={confirming}>
          <Ionicons name="arrow-back" size={rf(20)} color={colors.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('dashboards.retailer.checkoutTitle')}</Text>
        <View style={{ width: 20 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Order Summary */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('dashboards.retailer.orderSummary')}</Text>
          {cart.map((c) => {
            const tile = getVegetableTile(c.vegetable_name);
            return (
              <View key={c.vegetable_name} style={styles.itemRow}>
                <View style={[styles.itemTile, { backgroundColor: tile.bg }]}>
                  <Text style={styles.itemTileIcon}>{tile.icon}</Text>
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
                    {addr.is_default && (
                      <View style={styles.defaultBadge}>
                        <Text style={styles.defaultBadgeText}>Default</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              ))}

              <TouchableOpacity
                style={[styles.addressOption, useManualAddress && styles.addressOptionSelected]}
                onPress={handleUseManual}
                disabled={confirming}
              >
                <View style={styles.addressRadio}>
                  {useManualAddress && <View style={styles.addressRadioSelected} />}
                </View>
                <View style={styles.addressInfo}>
                  <Text style={styles.addressLabel}>+ {t('dashboards.retailer.useDifferentAddress')}</Text>
                </View>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.noAddressesText}>{t('dashboards.retailer.noSavedAddresses')}</Text>
          )}

          {(useManualAddress || savedAddresses.length === 0) && (
            <View style={styles.manualAddressContainer}>
              <View style={styles.addressRow}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder={t('dashboards.retailer.deliveryAddressPlaceholder')}
                  value={address}
                  onChangeText={setAddress}
                  editable={!confirming}
                  multiline
                />
                <TouchableOpacity
                  style={styles.pinBtn}
                  onPress={() => setMapModalVisible(true)}
                  disabled={confirming}
                >
                  <Ionicons name="location" size={rf(16)} color="#fff" />
                  <Text style={styles.pinBtnText}>{t('dashboards.retailer.pinLocation')}</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.manageAddressesLink}
                onPress={() => navigation.navigate('ManageAddresses')}
                disabled={confirming}
              >
                <Text style={styles.manageAddressesLinkText}>📋 {t('dashboards.retailer.manageAddresses')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Preferred Schedule */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('dashboards.retailer.preferredTimeLabel')}</Text>
          <DeliveryDateTimeFields date={date} onDateChange={setDate} time={time} onTimeChange={setTime} disabled={confirming} />
        </View>

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

      <MapPinningModal
        visible={mapModalVisible}
        onConfirm={handleMapConfirm}
        onClose={() => setMapModalVisible(false)}
        initialCoords={latitude != null && longitude != null ? { latitude: Number(latitude), longitude: Number(longitude) } : null}
        initialAddress={address || null}
      />

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
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadowCard,
  },
  sectionTitle: { fontFamily: fonts.heading, fontSize: rf(16), color: colors.ink, marginBottom: 12 },

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
  addressLabel: { fontFamily: fonts.bodyBold, fontSize: rf(14), color: colors.ink },
  addressText: { fontFamily: fonts.body, fontSize: rf(13), color: colors.inkSoft, marginTop: 2 },
  defaultBadge: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  defaultBadgeText: { color: '#fff', fontSize: rf(9), fontWeight: 'bold' },
  noAddressesText: { fontFamily: fonts.body, fontSize: rf(14), color: colors.inkSoft, marginVertical: 8 },
  manualAddressContainer: { marginTop: 8 },
  addressRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  input: {
    backgroundColor: '#fff',
    borderRadius: radius.ctrl,
    padding: 12,
    fontFamily: fonts.body,
    fontSize: rf(14.5),
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
  pinBtnText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(12.5) },
  manageAddressesLink: { marginTop: 8 },
  manageAddressesLinkText: { fontFamily: fonts.bodySemiBold, fontSize: rf(13), color: PRIMARY },

  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  itemTile: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  itemTileIcon: { fontSize: rf(18) },
  itemName: { fontFamily: fonts.bodyBold, fontSize: rf(14), color: colors.ink, textTransform: 'capitalize' },
  itemMeta: { fontFamily: fonts.body, fontSize: rf(12.5), color: colors.inkSoft, marginTop: 1 },
  itemSubtotal: { fontFamily: fonts.bodySemiBold, fontSize: rf(13.5), color: colors.ink },

  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, marginTop: 4, borderTopWidth: 1, borderTopColor: colors.border },
  summaryLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(15), color: colors.ink },
  summaryTotal: { fontFamily: fonts.heading, fontSize: rf(19), color: PRIMARY },

  button: { paddingVertical: 14, borderRadius: radius.ctrl, alignItems: 'center' },
  buttonPrimary: { backgroundColor: PRIMARY },
  buttonPrimaryText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(15.5) },
  buttonDisabled: { opacity: 0.6 },

  successBody: { alignItems: 'center', paddingVertical: 8 },
  successMessage: { fontFamily: fonts.body, fontSize: rf(14), color: colors.inkSoft, textAlign: 'center', marginTop: 12 },
});