import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ActivityIndicator,
    ScrollView,
    Alert,
    Dimensions,
    SafeAreaView,
    Platform,
} from 'react-native';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import * as Location from 'expo-location';

// SIMPLIFIED: Use a placeholder for web, real maps for mobile
let MapView, Marker, Polyline;

if (Platform.OS === 'web') {
    // Web placeholder - just a gray box with text
    MapView = ({ children, style, ...props }) => (
        <View style={[style, { backgroundColor: '#e0e0e0', justifyContent: 'center', alignItems: 'center' }]}>
            <Text style={{ color: '#666', fontSize: 16 }}>🗺️ Map View (Web)</Text>
            <Text style={{ color: '#999', fontSize: 12, marginTop: 4 }}>Route and markers would appear here</Text>
            {children}
        </View>
    );
    Marker = ({ children }) => children || null;
    Polyline = () => null;
} else {
    // Native - use real react-native-maps
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

const RiderNavigationScreen = ({ route, navigation }) => {
    const { orderId } = route.params;
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [trackingData, setTrackingData] = useState(null);
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [routeSteps, setRouteSteps] = useState([]);
    const [distance, setDistance] = useState(null);
    const [eta, setEta] = useState(null);
    const [remainingTime, setRemainingTime] = useState(null);
    const [error, setError] = useState(null);
    const mapRef = useRef(null);
    const intervalRef = useRef(null);

    // Fetch navigation data
    const fetchNavigationData = async () => {
        try {
            console.log('📡 Fetching tracking for order:', orderId);
            const data = await api.get(`/api/delivery/tracking/${orderId}`);
            console.log('📦 Full response:', data);

            if (!data) {
                setError('No data received from server');
                setLoading(false);
                return;
            }

            if (!data.delivery_personnel_id && data.status === 'pending') {
                setError('No rider assigned to this order yet. Please wait.');
                setLoading(false);
                return;
            }

            if (!data.rider_view) {
                console.log('⚠️ No rider_view. Keys:', Object.keys(data));
                setError('Rider location not available yet.');
                setLoading(false);
                return;
            }

            setTrackingData(data);

            const riderView = data.rider_view;
            console.log('📍 Rider view:', riderView);

            if (riderView.route_steps && riderView.route_steps.length > 0) {
                setRouteSteps(riderView.route_steps);
                setDistance(riderView.distance_km);
                setEta(riderView.eta_seconds);
            }

            if (riderView.full_route && riderView.full_route.coordinates && mapRef.current && Platform.OS !== 'web') {
                const coords = riderView.full_route.coordinates;
                if (coords.length > 0) {
                    const lats = coords.map(c => c[1]);
                    const lngs = coords.map(c => c[0]);
                    const minLat = Math.min(...lats);
                    const maxLat = Math.max(...lats);
                    const minLng = Math.min(...lngs);
                    const maxLng = Math.max(...lngs);

                    mapRef.current.fitToCoordinates(
                        [
                            { latitude: minLat, longitude: minLng },
                            { latitude: maxLat, longitude: maxLng },
                        ],
                        {
                            edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
                            animated: true,
                        }
                    );
                }
            }
            setError(null);
        } catch (err) {
            console.error('❌ Error fetching navigation:', err);
            setError('Failed to load tracking data: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchNavigationData();

        intervalRef.current = setInterval(fetchNavigationData, 15000);

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [orderId]);

    const sendLocation = async () => {
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') return;

            const location = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High,
            });

            await api.post('/api/delivery/update-location', {
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
                delivery_id: orderId,
            });
        } catch (error) {
            console.error('Location send error:', error);
        }
    };

    useEffect(() => {
        sendLocation();
        const locInterval = setInterval(sendLocation, 15000);
        return () => clearInterval(locInterval);
    }, [orderId]);

    useEffect(() => {
        if (routeSteps.length > 0) {
            const remainingTime = routeSteps.slice(currentStepIndex).reduce((sum, step) => sum + (step.duration || 0), 0);
            setRemainingTime(remainingTime);
        }
    }, [routeSteps, currentStepIndex]);

    const goToNextStep = () => {
        if (currentStepIndex < routeSteps.length - 1) {
            setCurrentStepIndex(currentStepIndex + 1);
        }
    };

    const completeDelivery = async () => {
        try {
            await api.put(`/api/deliveries/${orderId}/complete`, {
                proof_photo_url: null,
            });
            Alert.alert('✅ Delivery Complete!', 'Delivery has been marked as completed.');
            navigation.goBack();
        } catch (error) {
            console.error('Complete delivery error:', error);
            Alert.alert('Error', 'Could not complete delivery. Please try again.');
        }
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#2e7d32" />
                <Text style={styles.loadingText}>Loading route...</Text>
            </View>
        );
    }

    if (error) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                        <Text style={styles.backButtonText}>←</Text>
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>🚛 Navigation</Text>
                    <View style={styles.headerRight} />
                </View>
                <View style={styles.errorContainer}>
                    <Text style={styles.errorEmoji}>⚠️</Text>
                    <Text style={styles.errorTitle}>Tracking Unavailable</Text>
                    <Text style={styles.errorMessage}>{error}</Text>
                    <TouchableOpacity style={styles.retryButton} onPress={fetchNavigationData}>
                        <Text style={styles.retryButtonText}>Retry</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    const riderView = trackingData?.rider_view;
    const hasRoute = riderView?.full_route?.coordinates?.length > 0;
    const currentStep = routeSteps[currentStepIndex] || null;
    const nextStep = routeSteps[currentStepIndex + 1] || null;

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Text style={styles.backButtonText}>←</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>🚛 Navigation</Text>
                <View style={styles.headerRight} />
            </View>

            <View style={styles.etaBar}>
                <View style={styles.etaItem}>
                    <Text style={styles.etaLabel}>ETA</Text>
                    <Text style={styles.etaValue}>{eta ? formatTime(eta) : '--'}</Text>
                </View>
                <View style={styles.etaDivider} />
                <View style={styles.etaItem}>
                    <Text style={styles.etaLabel}>Distance</Text>
                    <Text style={styles.etaValue}>{distance ? `${distance} km` : '--'}</Text>
                </View>
                <View style={styles.etaDivider} />
                <View style={styles.etaItem}>
                    <Text style={styles.etaLabel}>Remaining</Text>
                    <Text style={styles.etaValue}>{remainingTime ? formatTime(remainingTime) : '--'}</Text>
                </View>
            </View>

            <View style={styles.mapContainer}>
                <MapView
                    ref={mapRef}
                    style={styles.map}
                    showsUserLocation={true}
                    showsMyLocationButton={true}
                    showsTraffic={true}
                    initialRegion={{
                        latitude: riderView?.current_location?.latitude || 14.0583,
                        longitude: riderView?.current_location?.longitude || 121.1485,
                        latitudeDelta: 0.02,
                        longitudeDelta: 0.02,
                    }}
                >
                    {hasRoute && Platform.OS !== 'web' && (
                        <Polyline
                            coordinates={riderView.full_route.coordinates.map(coord => ({
                                latitude: coord[1],
                                longitude: coord[0],
                            }))}
                            strokeWidth={5}
                            strokeColor="#2e7d32"
                        />
                    )}

                    {riderView?.pickup_location?.latitude && Platform.OS !== 'web' && (
                        <Marker
                            coordinate={{
                                latitude: riderView.pickup_location.latitude,
                                longitude: riderView.pickup_location.longitude,
                            }}
                            title="Pickup"
                            description={riderView.pickup_location.address}
                            pinColor="#2196f3"
                        />
                    )}

                    {riderView?.delivery_location?.latitude && Platform.OS !== 'web' && (
                        <Marker
                            coordinate={{
                                latitude: riderView.delivery_location.latitude,
                                longitude: riderView.delivery_location.longitude,
                            }}
                            title="Delivery"
                            description={riderView.delivery_location.address}
                            pinColor="#f44336"
                        />
                    )}
                </MapView>
            </View>

            <View style={styles.instructionsContainer}>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.stepsScroll}
                    contentContainerStyle={styles.stepsContent}
                >
                    {routeSteps.map((step, index) => (
                        <TouchableOpacity
                            key={index}
                            style={[
                                styles.stepItem,
                                index === currentStepIndex && styles.stepItemActive,
                                index < currentStepIndex && styles.stepItemCompleted
                            ]}
                            onPress={() => setCurrentStepIndex(index)}
                        >
                            <View style={styles.stepNumber}>
                                <Text style={[
                                    styles.stepNumberText,
                                    index === currentStepIndex && styles.stepNumberActive,
                                    index < currentStepIndex && styles.stepNumberCompleted
                                ]}>
                                    {index + 1}
                                </Text>
                            </View>
                            <Text style={styles.stepInstruction} numberOfLines={2}>
                                {step.instruction || 'Continue'}
                            </Text>
                            <Text style={styles.stepDistance}>
                                {(step.distance / 1000).toFixed(1)} km
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>

                {currentStep && (
                    <View style={styles.nextAction}>
                        <View style={styles.nextActionLeft}>
                            <Text style={styles.nextActionIcon}>
                                {getTurnIcon(currentStep.modifier, currentStep.type)}
                            </Text>
                            <View>
                                <Text style={styles.nextActionText}>
                                    {currentStep.instruction || 'Continue straight'}
                                </Text>
                                <Text style={styles.nextActionSub}>
                                    {nextStep ? `Then ${nextStep.instruction || 'continue'}` : 'Arriving soon'}
                                </Text>
                            </View>
                        </View>
                        <View style={styles.nextActionRight}>
                            <Text style={styles.nextActionDistance}>
                                {(currentStep.distance / 1000).toFixed(1)} km
                            </Text>
                            <Text style={styles.nextActionTime}>
                                {Math.round(currentStep.duration / 60)} min
                            </Text>
                        </View>
                    </View>
                )}
            </View>

            <View style={styles.actionButtons}>
                {routeSteps.length > 0 && currentStepIndex < routeSteps.length - 1 && (
                    <TouchableOpacity style={styles.nextButton} onPress={goToNextStep}>
                        <Text style={styles.nextButtonText}>Next Step →</Text>
                    </TouchableOpacity>
                )}

                {currentStepIndex === routeSteps.length - 1 && routeSteps.length > 0 && (
                    <TouchableOpacity style={styles.completeButton} onPress={() => {
                        Alert.alert('Complete Delivery', 'Mark this delivery as completed?', [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Complete', onPress: completeDelivery }
                        ]);
                    }}>
                        <Text style={styles.completeButtonText}>✅ Complete Delivery</Text>
                    </TouchableOpacity>
                )}
            </View>
        </SafeAreaView>
    );
};

function formatTime(seconds) {
    if (!seconds) return '--';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        return `${mins}m`;
    }
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hrs}h ${mins}m`;
}

function getTurnIcon(modifier, type) {
    if (type === 'depart') return '🚦';
    if (type === 'arrive') return '📍';
    if (modifier === 'left') return '⬅️';
    if (modifier === 'right') return '➡️';
    if (modifier === 'straight') return '⬆️';
    if (modifier === 'slight left') return '↙️';
    if (modifier === 'slight right') return '↘️';
    if (modifier === 'sharp left') return '↺';
    if (modifier === 'sharp right') return '↻';
    return '➡️';
}

export default RiderNavigationScreen;

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f5f5f5',
    },
    loadingText: {
        marginTop: 12,
        fontSize: 16,
        color: '#666',
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40,
    },
    errorEmoji: {
        fontSize: 48,
        marginBottom: 16,
    },
    errorTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#d32f2f',
        marginBottom: 8,
    },
    errorMessage: {
        fontSize: 14,
        color: '#666',
        textAlign: 'center',
        marginBottom: 24,
    },
    retryButton: {
        backgroundColor: '#2e7d32',
        paddingHorizontal: 32,
        paddingVertical: 12,
        borderRadius: 8,
    },
    retryButtonText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 16,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#2e7d32',
    },
    backButton: {
        padding: 4,
    },
    backButtonText: {
        fontSize: 24,
        color: '#fff',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#fff',
    },
    headerRight: {
        width: 40,
    },
    etaBar: {
        flexDirection: 'row',
        backgroundColor: '#fff',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    etaItem: {
        flex: 1,
        alignItems: 'center',
    },
    etaLabel: {
        fontSize: 11,
        color: '#666',
    },
    etaValue: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#2e7d32',
    },
    etaDivider: {
        width: 1,
        backgroundColor: '#e0e0e0',
        marginHorizontal: 8,
    },
    mapContainer: {
        flex: 1,
        minHeight: 300,
        backgroundColor: '#f0f0f0',
    },
    map: {
        flex: 1,
        backgroundColor: '#e0e0e0',
    },
    instructionsContainer: {
        backgroundColor: '#fff',
        maxHeight: 220,
        borderTopWidth: 1,
        borderTopColor: '#e0e0e0',
    },
    stepsScroll: {
        flexGrow: 0,
    },
    stepsContent: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    stepItem: {
        width: 140,
        marginRight: 12,
        padding: 12,
        borderRadius: 8,
        backgroundColor: '#f5f5f5',
        borderWidth: 1,
        borderColor: '#e0e0e0',
    },
    stepItemActive: {
        backgroundColor: '#e8f5e9',
        borderColor: '#2e7d32',
    },
    stepItemCompleted: {
        backgroundColor: '#c8e6c9',
        borderColor: '#2e7d32',
        opacity: 0.6,
    },
    stepNumber: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: '#ddd',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
    },
    stepNumberText: {
        fontSize: 12,
        color: '#666',
        fontWeight: 'bold',
    },
    stepNumberActive: {
        backgroundColor: '#2e7d32',
        color: '#fff',
    },
    stepNumberCompleted: {
        backgroundColor: '#4caf50',
        color: '#fff',
    },
    stepInstruction: {
        fontSize: 13,
        color: '#333',
        marginBottom: 4,
    },
    stepDistance: {
        fontSize: 11,
        color: '#666',
    },
    nextAction: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#e8f5e9',
        borderTopWidth: 1,
        borderTopColor: '#c8e6c9',
    },
    nextActionLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    nextActionIcon: {
        fontSize: 28,
        marginRight: 12,
    },
    nextActionText: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#1b5e20',
    },
    nextActionSub: {
        fontSize: 13,
        color: '#666',
    },
    nextActionRight: {
        alignItems: 'flex-end',
    },
    nextActionDistance: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#1b5e20',
    },
    nextActionTime: {
        fontSize: 12,
        color: '#666',
    },
    actionButtons: {
        padding: 16,
        backgroundColor: '#fff',
        borderTopWidth: 1,
        borderTopColor: '#e0e0e0',
    },
    nextButton: {
        backgroundColor: '#2196f3',
        paddingVertical: 14,
        borderRadius: 8,
        alignItems: 'center',
    },
    nextButtonText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 16,
    },
    completeButton: {
        backgroundColor: '#2e7d32',
        paddingVertical: 14,
        borderRadius: 8,
        alignItems: 'center',
    },
    completeButtonText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 16,
    },
});