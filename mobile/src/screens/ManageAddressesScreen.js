import useLatestRequest from '../hooks/useLatestRequest';
import useRequestLock from '../hooks/useRequestLock';
import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    TextInput,
    ActivityIndicator,
    Alert,
    Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { showAlert, confirmAction } from '../lib/ui';
import { friendlyError } from '../lib/errorMessages';
import { colors, control, fontSize, fonts, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { rf } from '../lib/responsive';
import MapPinningModal from '../components/MapPinningModal';
import ScreenHeader from '../components/ScreenHeader';
import CustomModal from '../components/CustomModal';
import StatusBadge from '../components/ui/StatusBadge';

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
            showAlert('We couldn’t load your addresses', 'Please check your internet connection and try again.');
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
        setFormLabel(address.label);
        setFormAddress(address.address);
        setFormLatitude(address.latitude ? String(address.latitude) : '');
        setFormLongitude(address.longitude ? String(address.longitude) : '');
        setFormIsDefault(address.is_default || false);
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
        showAlert('Please fill in the required fields', 'Give this address a short name, for example Home or Shop.');
        return;
    }
    if (!formAddress.trim()) {
        showAlert('Please fill in the required fields', 'Please enter the address.');
        return;
    }

    const payload = {
        label: formLabel.trim(),
        address: formAddress.trim(),
        latitude: formLatitude ? parseFloat(formLatitude) : null,
        longitude: formLongitude ? parseFloat(formLongitude) : null,
        is_default: formIsDefault,
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
        showAlert('Saved', editingAddress ? 'Your address has been updated.' : 'Your address has been added.');
    } catch (err) {
        console.error('Save address error:', err);
        showAlert('We couldn’t save this address', friendlyError(err, 'Please try again.'));
    } finally {
        requestLock.release('Saving');
        setSaving(false);
    }
};
    const deleteAddress = (address) => {
        confirmAction(
            'Delete this address?',
            `"${address.label}" will be removed from your saved addresses.`,
            async () => {
                if (!requestLock.acquire('Saving')) return;
                setSaving(true);
                try {
                    await api.delete(`/api/addresses/${address.id}`);
                    setAddresses(prev => prev.filter(a => a.id !== address.id));
                    await loadAddresses();
                    showAlert('Deleted', 'Your address has been removed.');
                } catch (err) {
                    showAlert('We couldn’t delete this address', friendlyError(err, 'Please try again.'));
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
            showAlert('Saved', 'This is now your default address.');
        } catch (err) {
            showAlert('We couldn’t update your default address', friendlyError(err, 'Please try again.'));
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
            <ScreenHeader title="My Addresses" onBack={() => navigation.goBack()} />

            <ScrollView contentContainerStyle={styles.content}>
                {addresses.length === 0 ? (
                    <View style={styles.empty}>
                        <Ionicons name="location-outline" size={rf(44)} color={colors.inkFaint} />
                        <Text style={styles.emptyTitle}>No saved addresses</Text>
                        <Text style={styles.emptyMessage}>Add your home, office, or other delivery locations</Text>
                    </View>
                ) : (
                    addresses.map((addr) => (
                        <View key={addr.id} style={styles.addressCard}>
                            <View style={styles.addressHeader}>
                                <Text style={styles.addressLabel}>{addr.label}</Text>
                                {addr.is_default && <StatusBadge status="active" label="Default" />}
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
                                        <Text style={styles.actionBtnText}>Set Default</Text>
                                    </TouchableOpacity>
                                )}
                                <TouchableOpacity
                                    style={[styles.actionBtn, styles.editBtn]}
                                    disabled={saving}
                                    onPress={() => openEditModal(addr)}
                                >
                                    <Text style={styles.actionBtnText}>Edit</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.actionBtn, styles.deleteBtn]}
                                    disabled={saving}
                                    onPress={() => deleteAddress(addr)}
                                >
                                    <Text style={[styles.actionBtnText, { color: colors.danger }]}>Delete</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    ))
                )}

                {saving && <ActivityIndicator color={PRIMARY} />}
                <TouchableOpacity disabled={saving} style={styles.addBtn} onPress={openAddModal}>
                    <Text style={styles.addBtnText}>+ Add New Address</Text>
                </TouchableOpacity>
            </ScrollView>

            {/* Add/Edit Modal with Map Pinning — shared CustomModal, matching
                every other modal in the app instead of a one-off overlay. */}
            <CustomModal
                visible={modalVisible}
                title={editingAddress ? 'Edit Address' : 'Add New Address'}
                confirmLabel="Save"
                onConfirm={saveAddress}
                cancelLabel="Cancel"
                onCancel={() => setModalVisible(false)}
                busy={saving}
            >
                <Text style={styles.fieldLabel}>Label (e.g., Home, Office)</Text>
                <TextInput
                    style={styles.input}
                    value={formLabel}
                    onChangeText={setFormLabel}
                    placeholder="Home" placeholderTextColor={colors.placeholder}
                />

                <Text style={styles.fieldLabel}>Address</Text>
                <View style={styles.addressRow}>
                    <TextInput
                        style={[styles.input, styles.addressInput, { flex: 1 }]}
                        value={formAddress}
                        onChangeText={setFormAddress}
                        placeholder="Street, City, Province" placeholderTextColor={colors.placeholder}
                        multiline
                    />
                    <TouchableOpacity
                        style={styles.pinBtn}
                        onPress={() => setMapModalVisible(true)}
                    >
                        <Ionicons name="location" size={rf(18)} color="#fff" />
                        <Text style={styles.pinBtnText}>Pin</Text>
                    </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabel}>Latitude (optional)</Text>
                <TextInput
                    style={styles.input}
                    value={formLatitude}
                    onChangeText={setFormLatitude}
                    placeholder="14.0583" placeholderTextColor={colors.placeholder}
                    keyboardType="numeric"
                />

                <Text style={styles.fieldLabel}>Longitude (optional)</Text>
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
                    <View style={[styles.checkbox, formIsDefault && styles.checkboxChecked]} />
                    <Text style={styles.checkboxLabel}>Set as default address</Text>
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
    actionBtn: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: radius.ctrl, borderWidth: 1, minHeight: control.height  },
    setDefaultBtn: { borderColor: PRIMARY },
    editBtn: { borderColor: colors.border },
    deleteBtn: { borderColor: colors.danger },
    actionBtnText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.ink, textAlign: 'center' },
    addBtn: {
        backgroundColor: PRIMARY,
        borderRadius: radius.ctrl,
        paddingVertical: 14,
        alignItems: 'center',
        marginTop: 8,
    },
    addBtnText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(fontSize.lg), textAlign: 'center' },
    fieldLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginTop: 10, marginBottom: 4 },
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
    addressRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
    pinBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingVertical: 10,
        paddingHorizontal: 12,
        backgroundColor: PRIMARY,
        borderRadius: radius.ctrl,
        marginTop: 4,
    },
    pinBtnText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(fontSize.sm), textAlign: 'center' },
    checkboxRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
    checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: PRIMARY, marginRight: 10 },
    checkboxChecked: { backgroundColor: PRIMARY },
    checkboxLabel: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.ink },
});
