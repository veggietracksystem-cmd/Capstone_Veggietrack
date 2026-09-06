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
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { showAlert, confirmAction } from '../lib/ui';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { rf } from '../lib/responsive';
import MapPinningModal from '../components/MapPinningModal';

const PRIMARY = colors.leaf700;

export default function ManageAddressesScreen({ navigation }) {
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

   const loadAddresses = async () => {
    try {
        const data = await api.get('/api/addresses');
        // If data is null or undefined, use empty array
        setAddresses(data || []);
    } catch (err) {
        console.error('Load addresses error:', err);
        // Only show error if it's a real error, not empty data
        if (err.message && err.message !== 'Request failed (404)') {
            showAlert('Error', 'Could not load addresses');
        }
    } finally {
        setLoading(false);
        setRefreshing(false);
    }
};

    useEffect(() => {
        loadAddresses();
    }, [loadAddresses]);

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
        showAlert('Error', 'Please enter a label (e.g., Home, Office)');
        return;
    }
    if (!formAddress.trim()) {
        showAlert('Error', 'Please enter the address');
        return;
    }

    const payload = {
        label: formLabel.trim(),
        address: formAddress.trim(),
        latitude: formLatitude ? parseFloat(formLatitude) : null,
        longitude: formLongitude ? parseFloat(formLongitude) : null,
        is_default: formIsDefault,
    };

    setSaving(true);
    try {
        let result;
        if (editingAddress) {
            result = await api.put(`/api/addresses/${editingAddress.id}`, payload);
        } else {
            result = await api.post('/api/addresses', payload);
        }
        console.log('Address saved:', result);
        setModalVisible(false);
        await loadAddresses();
        showAlert('Success', editingAddress ? 'Address updated' : 'Address added');
    } catch (err) {
        console.error('Save address error:', err);
        // Check if the error is a 404 or network issue
        if (err.message && err.message.includes('404')) {
            showAlert('Error', 'Address endpoint not found. Please check backend.');
        } else {
            showAlert('Error', err.message || 'Failed to save address');
        }
    } finally {
        setSaving(false);
    }
};
    const deleteAddress = (address) => {
        confirmAction(
            'Delete Address',
            `Are you sure you want to delete "${address.label}"?`,
            async () => {
                try {
                    await api.delete(`/api/addresses/${address.id}`);
                    await loadAddresses();
                    showAlert('Success', 'Address deleted');
                } catch (err) {
                    showAlert('Error', err.message || 'Failed to delete address');
                }
            }
        );
    };

    const setDefaultAddress = async (address) => {
        try {
            await api.put(`/api/addresses/${address.id}`, {
                ...address,
                is_default: true,
            });
            await loadAddresses();
            showAlert('Success', 'Default address updated');
        } catch (err) {
            showAlert('Error', err.message || 'Failed to update default');
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
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Text style={styles.backBtnText}>←</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>My Addresses</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                {addresses.length === 0 ? (
                    <View style={styles.empty}>
                        <Text style={styles.emptyIcon}>📍</Text>
                        <Text style={styles.emptyTitle}>No saved addresses</Text>
                        <Text style={styles.emptyMessage}>Add your home, office, or other delivery locations</Text>
                    </View>
                ) : (
                    addresses.map((addr) => (
                        <View key={addr.id} style={styles.addressCard}>
                            <View style={styles.addressHeader}>
                                <Text style={styles.addressLabel}>{addr.label}</Text>
                                {addr.is_default && (
                                    <View style={styles.defaultBadge}>
                                        <Text style={styles.defaultBadgeText}>Default</Text>
                                    </View>
                                )}
                            </View>
                            <Text style={styles.addressText}>{addr.address}</Text>
                            {addr.latitude && addr.longitude && (
                                <Text style={styles.coordsText}>
                                    📍 {addr.latitude.toFixed(4)}, {addr.longitude.toFixed(4)}
                                </Text>
                            )}
                            <View style={styles.addressActions}>
                                {!addr.is_default && (
                                    <TouchableOpacity
                                        style={[styles.actionBtn, styles.setDefaultBtn]}
                                        onPress={() => setDefaultAddress(addr)}
                                    >
                                        <Text style={styles.actionBtnText}>Set Default</Text>
                                    </TouchableOpacity>
                                )}
                                <TouchableOpacity
                                    style={[styles.actionBtn, styles.editBtn]}
                                    onPress={() => openEditModal(addr)}
                                >
                                    <Text style={styles.actionBtnText}>Edit</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.actionBtn, styles.deleteBtn]}
                                    onPress={() => deleteAddress(addr)}
                                >
                                    <Text style={[styles.actionBtnText, { color: colors.danger }]}>Delete</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    ))
                )}

                <TouchableOpacity style={styles.addBtn} onPress={openAddModal}>
                    <Text style={styles.addBtnText}>+ Add New Address</Text>
                </TouchableOpacity>
            </ScrollView>

            {/* Add/Edit Modal with Map Pinning */}
            {modalVisible && (
                <View style={styles.modalOverlay}>
                    <View style={styles.modalCard}>
                        <Text style={styles.modalTitle}>
                            {editingAddress ? 'Edit Address' : 'Add New Address'}
                        </Text>

                        <Text style={styles.fieldLabel}>Label (e.g., Home, Office)</Text>
                        <TextInput
                            style={styles.input}
                            value={formLabel}
                            onChangeText={setFormLabel}
                            placeholder="Home"
                        />

                        <Text style={styles.fieldLabel}>Address</Text>
                        <View style={styles.addressRow}>
                            <TextInput
                                style={[styles.input, styles.addressInput, { flex: 1 }]}
                                value={formAddress}
                                onChangeText={setFormAddress}
                                placeholder="Street, City, Province"
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
                            placeholder="14.0583"
                            keyboardType="numeric"
                        />

                        <Text style={styles.fieldLabel}>Longitude (optional)</Text>
                        <TextInput
                            style={styles.input}
                            value={formLongitude}
                            onChangeText={setFormLongitude}
                            placeholder="121.1485"
                            keyboardType="numeric"
                        />

                        <TouchableOpacity
                            style={styles.checkboxRow}
                            onPress={() => setFormIsDefault(!formIsDefault)}
                        >
                            <View style={[styles.checkbox, formIsDefault && styles.checkboxChecked]} />
                            <Text style={styles.checkboxLabel}>Set as default address</Text>
                        </TouchableOpacity>

                        <View style={styles.modalButtons}>
                            <TouchableOpacity
                                style={[styles.modalBtn, styles.modalCancel]}
                                onPress={() => setModalVisible(false)}
                                disabled={saving}
                            >
                                <Text style={styles.modalCancelText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.modalBtn, styles.modalSave, saving && styles.btnDisabled]}
                                onPress={saveAddress}
                                disabled={saving}
                            >
                                {saving ? (
                                    <ActivityIndicator size="small" color="#fff" />
                                ) : (
                                    <Text style={styles.modalSaveText}>Save</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            )}

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
    container: { flex: 1, backgroundColor: colors.bgScreen },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: colors.bgScreen,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    backBtn: { padding: 4 },
    backBtnText: { fontSize: 24, color: colors.ink },
    headerTitle: { fontSize: rf(19), fontFamily: fonts.heading, color: colors.ink },
    content: { padding: 16, paddingBottom: 40 },
    empty: { alignItems: 'center', marginTop: 60 },
    emptyIcon: { fontSize: 48, marginBottom: 16 },
    emptyTitle: { fontFamily: fonts.heading, fontSize: rf(18), color: colors.ink },
    emptyMessage: { fontFamily: fonts.body, fontSize: rf(14), color: colors.inkSoft, textAlign: 'center', marginTop: 8 },
    addressCard: {
        backgroundColor: colors.card,
        borderRadius: radius.card,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: colors.border,
        ...shadowCard,
    },
    addressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    addressLabel: { fontFamily: fonts.bodyBold, fontSize: rf(16), color: colors.ink },
    defaultBadge: { backgroundColor: PRIMARY, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
    defaultBadgeText: { color: '#fff', fontSize: rf(10), fontWeight: 'bold' },
    addressText: { fontFamily: fonts.body, fontSize: rf(14), color: colors.inkSoft, marginTop: 2 },
    coordsText: { fontFamily: fonts.body, fontSize: rf(12), color: colors.inkFaint, marginTop: 4 },
    addressActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
    actionBtn: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: radius.ctrl, borderWidth: 1 },
    setDefaultBtn: { borderColor: PRIMARY },
    editBtn: { borderColor: colors.border },
    deleteBtn: { borderColor: colors.danger },
    actionBtnText: { fontFamily: fonts.bodySemiBold, fontSize: rf(12), color: colors.ink },
    addBtn: {
        backgroundColor: PRIMARY,
        borderRadius: radius.ctrl,
        paddingVertical: 14,
        alignItems: 'center',
        marginTop: 8,
    },
    addBtnText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(15) },
    modalOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalCard: {
        backgroundColor: colors.bgScreen,
        borderRadius: radius.card,
        padding: 20,
        width: '100%',
        maxWidth: 400,
        ...shadowCard,
    },
    modalTitle: { fontFamily: fonts.heading, fontSize: rf(18), color: colors.ink, marginBottom: 16 },
    fieldLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(12), color: colors.inkSoft, marginTop: 10, marginBottom: 4 },
    input: {
        backgroundColor: colors.card,
        borderRadius: radius.ctrl,
        padding: 10,
        borderWidth: 1,
        borderColor: colors.border,
        fontFamily: fonts.body,
        fontSize: rf(14),
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
    pinBtnText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(12) },
    checkboxRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
    checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: PRIMARY, marginRight: 10 },
    checkboxChecked: { backgroundColor: PRIMARY },
    checkboxLabel: { fontFamily: fonts.body, fontSize: rf(14), color: colors.ink },
    modalButtons: { flexDirection: 'row', gap: 10, marginTop: 16 },
    modalBtn: { flex: 1, paddingVertical: 12, borderRadius: radius.ctrl, alignItems: 'center' },
    modalCancel: { borderWidth: 1, borderColor: colors.border },
    modalCancelText: { fontFamily: fonts.bodySemiBold, color: colors.inkSoft },
    modalSave: { backgroundColor: PRIMARY },
    modalSaveText: { fontFamily: fonts.bodySemiBold, color: '#fff' },
    btnDisabled: { opacity: 0.5 },
});
