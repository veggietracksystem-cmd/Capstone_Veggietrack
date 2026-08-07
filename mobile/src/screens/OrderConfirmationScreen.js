import { rf } from '../lib/responsive';
import { useState } from 'react';
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

// Reached from the Retailer Cart tab's "Place Order" button. Collects the
// delivery date/time + address that the Cart tab used to collect directly,
// reviews the order, and only then submits it — placing the order no longer
// happens as a side effect of tapping "Place Order" on the Cart.
export default function OrderConfirmationScreen({ navigation, route }) {
  const { user } = useAuth();
  const { t, language } = useTranslation();
  const { cart = [], totalItems = 0, totalAmount = 0, defaultAddress = '' } = route.params || {};

  const [address, setAddress] = useState(defaultAddress || user?.store_location || '');
  const [latitude, setLatitude] = useState(null);
  const [longitude, setLongitude] = useState(null);
  const [mapModalVisible, setMapModalVisible] = useState(false);
  const [date, setDate] = useState(todayKey()); // defaults to the current order date, editable
  const [time, setTime] = useState(''); // required, no default
  const [confirming, setConfirming] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleMapConfirm = ({ latitude: lat, longitude: lng, address: addr }) => {
    setLatitude(lat);
    setLongitude(lng);
    setAddress(addr);
    setMapModalVisible(false);
  };

  const canConfirm = !!address.trim() && !!date && !!time;

  const confirmOrder = async () => {
    const payload = {
      items: cart.map((c) => ({ vegetable_name: c.vegetable_name, quantity_kg: c.quantity })),
      delivery_address: address.trim(),
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

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('dashboards.retailer.preferredTimeLabel')}</Text>
          <DeliveryDateTimeFields date={date} onDateChange={setDate} time={time} onTimeChange={setTime} disabled={confirming} />
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('dashboards.retailer.deliveryAddressLabel')}</Text>
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
        </View>

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
