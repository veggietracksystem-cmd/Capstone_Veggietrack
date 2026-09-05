import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ActivityIndicator,
    ScrollView,
    RefreshControl,
    Alert,
    Dimensions,
    SafeAreaView,
    Platform,
} from 'react-native';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';

// Map placeholder for web, real maps for mobile
let MapView, Marker, Polyline;
if (Platform.OS === 'web') {
    MapView = ({ children, style, ...props }) => (
        <View style={[style, { backgroundColor: '#e0e0e0', justifyContent: 'center', alignItems: 'center' }]}>
            <Text style={{ color: '#666', fontSize: 16 }}>🗺️ Live Tracking (Web)</Text>
            <Text style={{ color: '#999', fontSize: 12, marginTop: 4 }}>Rider location updates here</Text>
            {children}
        </View>
    );
    Marker = ({ children }) => children || null;
    Polyline = () => null;
} else {
    try {
        MapView = require('react-native-maps').default;
        Marker = require('react-native-maps').Marker;
        Polyline = require('react-native-maps').Polyline;
    } catch (e) {
        MapView = View;
        Marker = View;
        Polyline = View;
    }
}

const { width, height } = Dimensions.get('window');

export const ShopeeTrackingScreen = ({ route, navigation }) => {
    const { orderId } = route.params;
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [trackingData, setTrackingData] = useState(null);
    const [riderLocation, setRiderLocation] = useState(null);
    const [eta, setEta] = useState(null);
    const [distance, setDistance] = useState(null);
    const [status, setStatus] = useState(null);
    const mapRef = useRef(null);
    const intervalRef = useRef(null);

    const fetchTrackingData = async () => {
        try {
            const data = await api.get(`/api/delivery/tracking/${orderId}`);
            setTrackingData(data);
            setStatus(data.status);

            // Use retailer_view data
            const retailerView = data.retailer_view;
            if (retailerView) {
                if (retailerView.rider.latitude && retailerView.rider.longitude) {
                    setRiderLocation({
                        latitude: retailerView.rider.latitude,
                        longitude: retailerView.rider.longitude,
                    });
                }
                if (retailerView.tracking.eta_formatted) {
                    setEta(retailerView.tracking.eta_formatted);
                    setDistance(retailerView.tracking.distance_km);
                }
            }
        } catch (error) {
            console.error('Error fetching tracking:', error);
            Alert.alert('Error', 'Could not load tracking data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTrackingData();
        intervalRef.current = setInterval(fetchTrackingData, 5000); // refresh every 5 sec
        return () => clearInterval(intervalRef.current);
    }, [orderId]);

    const onRefresh = async () => {
        setRefreshing(true);
        await fetchTrackingData();
        setRefreshing(false);
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#2e7d32" />
                <Text style={styles.loadingText}>Loading tracking...</Text>
            </View>
        );
    }

    const retailerView = trackingData?.retailer_view;
    const isDelivered = status === 'delivered';
    const hasRiderLocation = riderLocation && riderLocation.latitude && riderLocation.longitude;

    const getStatusColor = (status) => {
        switch (status) {
            case 'pending': return '#ff9800';
            case 'approved': return '#2196f3';
            case 'in_transit': return '#2e7d32';
            case 'delivered': return '#4caf50';
            case 'cancelled': return '#f44336';
            default: return '#757575';
        }
    };

    const getStatusLabel = (status) => {
        switch (status) {
            case 'pending': return '⏳ Pending';
            case 'approved': return '✅ Approved';
            case 'in_transit': return '🚛 In Transit';
            case 'delivered': return '✅ Delivered';
            case 'cancelled': return '❌ Cancelled';
            default: return status;
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Text style={styles.backButtonText}>←</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Track Delivery</Text>
                <View style={{ width: 40 }} />
            </View>

            {/* Status + ETA */}
            <View style={styles.statusContainer}>
                <View style={styles.statusRow}>
                    <Text style={styles.orderId}>Order #{orderId.slice(0, 8)}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(status) }]}>
                        <Text style={styles.statusBadgeText}>{getStatusLabel(status)}</Text>
                    </View>
                </View>
                {!isDelivered && (
                    <View style={styles.etaRow}>
                        <Text style={styles.etaLabel}>🚛 ETA: {eta || 'Calculating...'}</Text>
                        <Text style={styles.distanceLabel}>{distance ? `${distance} km away` : '--'}</Text>
                    </View>
                )}
            </View>

            {/* Map with moving truck */}
            <View style={styles.mapContainer}>
                <MapView
                    ref={mapRef}
                    style={styles.map}
                    showsUserLocation={true}
                    initialRegion={{
                        latitude: riderLocation?.latitude || retailerView?.delivery?.latitude || 14.0583,
                        longitude: riderLocation?.longitude || retailerView?.delivery?.longitude || 121.1485,
                        latitudeDelta: 0.02,
                        longitudeDelta: 0.02,
                    }}
                >
                    {/* Rider marker */}
                    {hasRiderLocation && (
                        <Marker
                            coordinate={riderLocation}
                            title={retailerView?.rider?.name || 'Rider'}
                            description="Current location"
                        >
                            <View style={styles.truckMarker}>
                                <Text style={styles.truckEmoji}>🚛</Text>
                            </View>
                        </Marker>
                    )}

                    {/* Delivery marker */}
                    {retailerView?.delivery?.latitude && (
                        <Marker
                            coordinate={{
                                latitude: retailerView.delivery.latitude,
                                longitude: retailerView.delivery.longitude,
                            }}
                            title="Delivery Location"
                            description={retailerView.delivery.address}
                            pinColor="red"
                        />
                    )}

                    {/* Pickup marker */}
                    {retailerView?.pickup?.latitude && (
                        <Marker
                            coordinate={{
                                latitude: retailerView.pickup.latitude,
                                longitude: retailerView.pickup.longitude,
                            }}
                            title="Pickup Location"
                            description={retailerView.pickup.address}
                            pinColor="blue"
                        />
                    )}
                </MapView>

                {/* Live badge */}
                {hasRiderLocation && !isDelivered && (
                    <View style={styles.liveBadge}>
                        <View style={styles.liveDot} />
                        <Text style={styles.liveBadgeText}>LIVE</Text>
                    </View>
                )}
            </View>

            {/* Rider info */}
            <View style={styles.riderInfo}>
                <View style={styles.riderInfoLeft}>
                    <Text style={styles.riderEmoji}>🛵</Text>
                    <View>
                        <Text style={styles.riderName}>{retailerView?.rider?.name || 'Rider'}</Text>
                        <Text style={styles.riderStatus}>
                            {hasRiderLocation ? '📍 Live tracking active' : '⏳ Waiting for location...'}
                        </Text>
                    </View>
                </View>
                {hasRiderLocation && (
                    <Text style={styles.riderDistance}>{distance ? `${distance} km` : '--'}</Text>
                )}
            </View>

            {/* Delivery address */}
            <View style={styles.addressCard}>
                <Text style={styles.addressLabel}>📍 Delivery Address</Text>
                <Text style={styles.addressText}>{retailerView?.delivery?.address || 'No address'}</Text>
            </View>

            {/* Order items */}
            <View style={styles.itemsCard}>
                <Text style={styles.itemsLabel}>🛒 Order Items</Text>
                {retailerView?.items?.map((item, index) => (
                    <View key={index} style={styles.itemRow}>
                        <Text style={styles.itemName}>{item.vegetable_name}</Text>
                        <Text style={styles.itemQty}>{item.quantity_kg} kg</Text>
                    </View>
                ))}
            </View>

            {/* Help button */}
            <TouchableOpacity style={styles.helpButton}>
                <Text style={styles.helpButtonText}>❓ Need Help?</Text>
            </TouchableOpacity>

            <ScrollView
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                contentContainerStyle={{ paddingBottom: 20 }}
            />
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f5f5f5' },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' },
    loadingText: { marginTop: 12, fontSize: 16, color: '#666' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#2e7d32',
    },
    backButton: { padding: 4 },
    backButtonText: { fontSize: 24, color: '#fff' },
    headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
    statusContainer: { backgroundColor: '#fff', padding: 16, marginBottom: 8 },
    statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    orderId: { fontSize: 16, fontWeight: 'bold', color: '#333' },
    statusBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
    statusBadgeText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
    etaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
    etaLabel: { fontSize: 14, color: '#2e7d32', fontWeight: 'bold' },
    distanceLabel: { fontSize: 14, color: '#666' },
    mapContainer: { height: 300, backgroundColor: '#e0e0e0', marginBottom: 8, position: 'relative' },
    map: { flex: 1 },
    truckMarker: { backgroundColor: '#2e7d32', borderRadius: 20, padding: 6, borderWidth: 2, borderColor: '#fff' },
    truckEmoji: { fontSize: 22 },
    liveBadge: {
        position: 'absolute',
        top: 10,
        right: 10,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.7)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
    },
    liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ff0000', marginRight: 6 },
    liveBadgeText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
    riderInfo: {
        backgroundColor: '#fff',
        padding: 16,
        marginBottom: 8,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    riderInfoLeft: { flexDirection: 'row', alignItems: 'center' },
    riderEmoji: { fontSize: 24, marginRight: 12 },
    riderName: { fontSize: 16, fontWeight: 'bold', color: '#333' },
    riderStatus: { fontSize: 12, color: '#666' },
    riderDistance: { fontSize: 14, fontWeight: 'bold', color: '#2e7d32' },
    addressCard: { backgroundColor: '#fff', padding: 16, marginBottom: 8 },
    addressLabel: { fontSize: 14, fontWeight: 'bold', color: '#333', marginBottom: 4 },
    addressText: { fontSize: 14, color: '#666' },
    itemsCard: { backgroundColor: '#fff', padding: 16, marginBottom: 8 },
    itemsLabel: { fontSize: 14, fontWeight: 'bold', color: '#333', marginBottom: 8 },
    itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
    itemName: { fontSize: 14, color: '#333' },
    itemQty: { fontSize: 14, color: '#666' },
    helpButton: { backgroundColor: '#fff', padding: 16, marginHorizontal: 16, borderRadius: 8, alignItems: 'center', marginBottom: 16 },
    helpButtonText: { fontSize: 16, color: '#2e7d32', fontWeight: 'bold' },
});

export default ShopeeTrackingScreen;