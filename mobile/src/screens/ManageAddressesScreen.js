import useLatestRequest from '../hooks/useLatestRequest';
import useRequestLock from '../hooks/useRequestLock';
import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
    Alert,
    Platform,
} from 'react-native';
import TextInput from '../components/AppTextInput';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { showAlert, confirmAction } from '../lib/ui';
import { friendlyError } from '../lib/errorMessages';
import { colors, control, fontSize, fonts, radius, shadowCard, actionBtn, actionBtnOutline, actionBtnPrimary, actionBtnDanger, actionBtnText } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { rf } from '../lib/responsive';
import MapPinningModal from '../components/MapPinningModal';
import ScreenHeader from '../components/ScreenHeader';
import CustomModal from '../components/CustomModal';
import StatusBadge from '../components/ui/StatusBadge';
import { titleCaseWords } from '../lib/textFormat';
import Checkbox from '../components/Checkbox';

const PRIMARY = colors.leaf700;

export default function ManageAddressesScreen({ navigation }) {
  const beginRead = useLatestRequest();
  const requestLock = useRequestLock();
    const { user } = useAuth();
    const { t } = useTranslation();
    const [addresses, setAddresses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    // Modal state for add/edit
    const [modalVisible, setModalVisible] = useState(false);
    const [editingAddress, setEditingAddress] = useState(null);
    const [formLabel, setFormLabel] = useState('');
    const [formAddress, setFormAddress] = useState('');
    const [formLatitude, setFormLatitude] = useState('');
    const [formLongitude, setFormLongitude] = useState('');
    const [formIsDefault, setFormIsDefault] = useState(false);
    const [saving, setSaving] = useState(false);
    const [mapModalVisible, setMapModalVisible] = useState(false);

   const loadAddresses = useCallback(async () => {
    const isCurrent = beginRead('loadAddresses');
    try {
        const data = await api.get('/api/addresses');
        // If data is null or undefined, use empty array
        if (!isCurrent()) return;
        setAddresses(data || []);
    } catch (err) {
      if (!isCurrent()) return;
        console.error('Load addresses error:', err);
        // Only show error if it's a real error, not empty data
        if (err.status !== 404) {
            showAlert(t('addr.loadFailedTitle'), t('addr.checkConnection'));
        }
    } finally {
        if (isCurrent()) { setLoading(false); setRefreshing(false); }
    }
}, []);

    useFocusEffect(useCallback(() => {
        loadAddresses();
    }, [loadAddresses]));

    const openAddModal = () => {
        setEditingAddress(null);
        setFormLabel('');
        setFormAddress('');
        setFormLatitude('');
        setFormLongitude('');
        setFormIsDefault(false);
        setModalVisible(true);
    };

    const openEditModal = (address) => {
        setEditingAddress(address);
        setFormLabel(titleCaseWords(address.label));
        setFormAddress(address.address);
        setFormLatitude(address.latitude ? String(address.latitude) : '');
        setFormLongitude(address.longitude ? String(address.longitude) : '');
        setFormIsDefault(false); // never pre-checked; the user opts in each time
        setModalVisible(true);
    };

    const handleMapConfirm = ({ latitude, longitude, address }) => {
        setFormLatitude(String(latitude));
        setFormLongitude(String(longitude));
        setFormAddress(address);
        setMapModalVisible(false);
    };

  const saveAddress = async () => {
    if (!formLabel.trim()) {
        showAlert(t('addr.fillRequired'), t('addr.needLabel'));
        return;
    }
    if (!formAddress.trim()) {
        showAlert(t('addr.fillRequired'), t('addr.needAddress'));
        return;
    }

    const payload = {
        label: titleCaseWords(formLabel.trim()),
        address: formAddress.trim(),
        latitude: formLatitude ? parseFloat(formLatitude) : null,
        longitude: formLongitude ? parseFloat(formLongitude) : null,
        // Unchecked means "leave as is": an address that is already the default stays the default.
        is_default: formIsDefault || !!editingAddress?.is_default,
    };

    if (!requestLock.acquire('Saving')) return;

    setSaving(true);
    try {
        let result;
        if (editingAddress) {
            result = await api.put(`/api/addresses/${editingAddress.id}`, payload);
        } else {
            result = await api.post('/api/addresses', payload);
        }

        beginRead('loadAddresses');
        setAddresses(prev => {
            const rows = prev.filter(a => a.id !== result.id);
            return [result, ...rows.map(a => result.is_default ? { ...a, is_default: false } : a)];
        });
        setModalVisible(false);
        await loadAddresses();
        showAlert(t('addr.saved'), editingAddress ? t('addr.updatedMsg') : t('addr.addedMsg'));
    } catch (err) {
        console.error('Save address error:', err);
        showAlert(t('addr.saveFailed'), friendlyError(err, t('errors.tryAgain')));
    } finally {
        requestLock.release('Saving');
        setSaving(false);
    }
};
    const deleteAddress = (address) => {
        confirmAction(
            t('addr.deleteTitle'),
            t('addr.deleteMsg', { label: titleCaseWords(address.label) }),
            async () => {
                if (!requestLock.acquire('Saving')) return;
                setSaving(true);
                try {
                    await api.delete(`/api/addresses/${address.id}`);
                    setAddresses(prev => prev.filter(a => a.id !== address.id));
                    await loadAddresses();
                    showAlert(t('addr.deleted'), t('addr.deletedMsg'));
                } catch (err) {
                    showAlert(t('addr.deleteFailed'), friendlyError(err, t('errors.tryAgain')));
                } finally {
                    requestLock.release('Saving');
                    setSaving(false);
                }
            }
        );
    };

    const setDefaultAddress = async (address) => {
        if (!requestLock.acquire('Saving')) return;
        setSaving(true);
        try {
            await api.put(`/api/addresses/${address.id}`, {
                ...address,
                is_default: true,
            });
            await loadAddresses();
            showAlert(t('addr.saved'), t('addr.nowDefault'));
        } catch (err) {
            showAlert(t('addr.defaultFailed'), friendlyError(err, t('errors.tryAgain')));
        } finally {
            requestLock.release('Saving');
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color={PRIMARY} />
            </View>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            <ScreenHeader title={t('addr.myAddresses')} onBack={() => navigation.goBack()} />

            <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
                {addresses.length === 0 ? (
                    <View style={styles.empty}>
                        <Ionicons name="location-outline" size={rf(44)} color={colors.inkFaint} />
                        <Text style={styles.emptyTitle}>{t('addr.noSaved')}</Text>
                        <Text style={styles.emptyMessage}>{t('addr.noSavedHint')}</Text>
                    </View>
                ) : (
                    addresses.map((addr) => (
                        <View key={addr.id} style={styles.addressCard}>
                            <View style={styles.addressHeader}>
                                <Text style={styles.addressLabel}>{titleCaseWords(addr.label)}</Text>
                                {addr.is_default && <StatusBadge status="active" label={t('addr.default')} />}
                            </View>
                            <Text style={styles.addressText}>{addr.address}</Text>
                            {addr.latitude && addr.longitude && (
                                <View style={styles.coordsRow}>
                                    <Ionicons name="location-outline" size={rf(16)} color={colors.inkFaint} />
                                    <Text style={styles.coordsText}>
                                        {addr.latitude.toFixed(4)}, {addr.longitude.toFixed(4)}
                                    </Text>
                                </View>
                            )}
                            <View style={styles.addressActions}>
                                {!addr.is_default && (
                                    <TouchableOpacity
                                        style={[styles.actionBtn, styles.setDefaultBtn]}
                                        disabled={saving}
                                        onPress={() => setDefaultAddress(addr)}
                                    >
                                        <Text style={styles.actionBtnText}>{t('addr.setDefault')}</Text>
                                    </TouchableOpacity>
                                )}
                                <TouchableOpacity
                                    style={[styles.actionBtn, styles.editBtn]}
                                    disabled={saving}
                                    onPress={() => openEditModal(addr)}
                                >
                                    <Text style={[styles.actionBtnText, styles.editBtnText]}>{t('common.edit')}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.actionBtn, styles.deleteBtn]}
                                    disabled={saving}
                                    onPress={() => deleteAddress(addr)}
                                >
                                    <Text style={[styles.actionBtnText, { color: colors.danger }]}>{t('common.delete')}</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    ))
                )}

                {saving && <ActivityIndicator color={PRIMARY} />}
                <TouchableOpacity disabled={saving} style={styles.addBtn} onPress={openAddModal}>
                    <Text style={styles.addBtnText}>{t('addr.addNew')}</Text>
                </TouchableOpacity>
            </ScrollView>

            {/* Add/Edit Modal with Map Pinning — shared CustomModal, matching
                every other modal in the app instead of a one-off overlay. */}
            <CustomModal
                visible={modalVisible}
                title={editingAddress ? t('addr.editTitle') : t('addr.addTitle')}
                confirmLabel={t('common.save')}
                onConfirm={saveAddress}
                cancelLabel={t('common.cancel')}
                onCancel={() => setModalVisible(false)}
                busy={saving}
            >
                <Text style={styles.fieldLabel}>{t('addr.labelField')}</Text>
                <TextInput
                    style={styles.input}
                    value={formLabel}
                                        autoCapitalize="words"
                    onChangeText={(v) => setFormLabel(titleCaseWords(v))}
                    placeholder={t('addr.labelPh')} placeholderTextColor={colors.placeholder}
                />

                <Text style={styles.fieldLabel}>{t('addr.addressField')}</Text>
                <View style={styles.addressRow}>
                    <TextInput
                        style={[styles.input, styles.addressInput, { flex: 1 }]}
                        value={formAddress}
                                                autoCapitalize="words"
                        onChangeText={(v) => setFormAddress(titleCaseWords(v))}
                        placeholder={t('addr.addressPh')} placeholderTextColor={colors.placeholder}
                        multiline
                    />
                    <TouchableOpacity
                        style={styles.pinBtn}
                        onPress={() => setMapModalVisible(true)}
                    >
                        <Ionicons name="location-outline" size={rf(16)} color={colors.leaf700} />
                        <Text style={styles.pinBtnText}>{t('addr.pin')}</Text>
                    </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabel}>{t('addr.latField')}</Text>
                <TextInput
                    style={styles.input}
                    value={formLatitude}
                    onChangeText={setFormLatitude}
                    placeholder="14.0583" placeholderTextColor={colors.placeholder}
                    keyboardType="numeric"
                />

                <Text style={styles.fieldLabel}>{t('addr.lngField')}</Text>
                <TextInput
                    style={styles.input}
                    value={formLongitude}
                    onChangeText={setFormLongitude}
                    placeholder="121.1485" placeholderTextColor={colors.placeholder}
                    keyboardType="numeric"
                />

                <TouchableOpacity
                    style={styles.checkboxRow}
                    onPress={() => setFormIsDefault(!formIsDefault)}
                >
                    <Checkbox checked={formIsDefault} style={styles.checkbox} />
                    <Text style={styles.checkboxLabel}>{t('addr.setAsDefault')}</Text>
                </TouchableOpacity>
            </CustomModal>

            {/* Map Pinning Modal */}
            <MapPinningModal
                visible={mapModalVisible}
                onConfirm={handleMapConfirm}
                onClose={() => setMapModalVisible(false)}
                initialCoords={
                    formLatitude && formLongitude
                        ? { latitude: parseFloat(formLatitude), longitude: parseFloat(formLongitude) }
                        : null
                }
                initialAddress={formAddress || null}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#FFFFFF' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    content: { padding: 16, paddingBottom: 40 },
    empty: { alignItems: 'center', marginTop: 60 },
    emptyIcon: { fontSize: 48, marginBottom: 16 },
    emptyTitle: { fontFamily: fonts.heading, fontSize: rf(fontSize.xl), color: colors.ink },
    emptyMessage: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.inkSoft, textAlign: 'center', marginTop: 8 },
    addressCard: {
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: colors.border,
        ...shadowCard,
    },
    addressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    addressLabel: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg), color: colors.ink },
    addressText: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.inkSoft, marginTop: 2 },
    coordsText: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkFaint, marginTop: 4 },
    coordsRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    addressActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
    actionBtn: { ...actionBtn },
    setDefaultBtn: { ...actionBtnOutline },
    // Matches the Distributor module's Edit action button exactly (compact
    // outlined green pill) so Edit looks the same everywhere it appears.
    editBtn: { ...actionBtnOutline },
    editBtnText: { color: PRIMARY },
    deleteBtn: { ...actionBtnDanger },
    actionBtnText: { ...actionBtnText, color: colors.ink },
    addBtn: {
        backgroundColor: PRIMARY,
        borderRadius: radius.ctrl,
        paddingVertical: 14,
        alignItems: 'center',
        marginTop: 8,
    },
    addBtnText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(fontSize.lg), textAlign: 'center' },
    fieldLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.labelInk, marginTop: 10, marginBottom: 4 },
    input: {
        backgroundColor: colors.card,
        borderRadius: radius.ctrl,
        padding: 10,
        borderWidth: 1,
        borderColor: colors.border,
        fontFamily: fonts.body,
        fontSize: rf(fontSize.md),
        color: colors.ink,
    },
    addressInput: { minHeight: 50, textAlignVertical: 'top' },
    addressRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
    pinBtn: { ...actionBtn, ...actionBtnOutline, flexDirection: 'row', gap: 6, alignSelf: 'center', flexShrink: 0 },
    pinBtnText: { ...actionBtnText, color: colors.leaf700 },
    checkboxRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
    checkbox: { marginRight: 10 },
    checkboxLabel: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.ink },
});
