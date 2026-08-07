import { useState, useEffect, useRef } from 'react';
import { View, Text, Modal, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { rf } from '../lib/responsive';

const PRIMARY = '#1E4E09';
const SAN_PABLO = { latitude: 14.0683, longitude: 121.3256 };

export default function MapPinningModal({ visible, onConfirm, onClose, initialCoords, initialAddress }) {
  const [pinnedCoords, setPinnedCoords] = useState(initialCoords || SAN_PABLO);
  const [addressName, setAddressName] = useState(initialAddress || 'Fetching address...');
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const [loadingAddress, setLoadingAddress] = useState(false);
  const [detectingLocation, setDetectingLocation] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const mapRef = useRef(null);
  const markerRef = useRef(null);

  // 0. Re-seed from the caller's existing pin (e.g. Edit Profile) each time the
  // modal opens, so re-opening after a cancel doesn't lose the saved location.
  useEffect(() => {
    if (!visible || !initialCoords) return;
    setPinnedCoords(initialCoords);
    setAddressName(initialAddress || 'Fetching address...');
  }, [visible]);

  // 1. Load Leaflet CDN script dynamically
  useEffect(() => {
    if (!visible) return;
    if (window.L) {
      setLeafletLoaded(true);
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => setLeafletLoaded(true);
    document.head.appendChild(script);
  }, [visible]);

  // 2. Auto-detect user current location on modal open — skipped when an
  // existing pin was passed in, so editing a saved location doesn't silently
  // jump to the device's current GPS position.
  useEffect(() => {
    if (!visible || initialCoords) return;
    handleDetectLocation();
  }, [visible]);

  const handleDetectLocation = () => {
    if (typeof window === 'undefined' || !navigator.geolocation) return;
    setDetectingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const coords = { latitude: lat, longitude: lng };
        setPinnedCoords(coords);
        setDetectingLocation(false);
        if (mapRef.current && markerRef.current) {
          mapRef.current.setView([lat, lng], 16);
          markerRef.current.setLatLng([lat, lng]);
        }
      },
      (err) => {
        console.warn('[MapPinningModal] Geolocation error or denied:', err);
        setDetectingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  // 3. Reverse geocode when coordinates change
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    (async () => {
      setLoadingAddress(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${pinnedCoords.latitude}&lon=${pinnedCoords.longitude}`
        );
        const data = await res.json();
        if (!cancelled) {
          setAddressName(
            data.display_name ||
              `${pinnedCoords.latitude.toFixed(4)}, ${pinnedCoords.longitude.toFixed(4)}`
          );
        }
      } catch {
        if (!cancelled) {
          setAddressName(
            `${pinnedCoords.latitude.toFixed(4)}, ${pinnedCoords.longitude.toFixed(4)}`
          );
        }
      } finally {
        if (!cancelled) setLoadingAddress(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, pinnedCoords]);

  // 4. Initialize Map
  useEffect(() => {
    if (!visible || !leafletLoaded) return;

    const container = document.getElementById('pinning-map-leaflet');
    if (!container) return;

    // Seed from the caller's existing pin (not the possibly-stale `pinnedCoords`
    // closure) so the map is torn down/recreated fresh each open and always
    // starts centered on the saved location rather than a leftover unconfirmed one.
    const seed = initialCoords || pinnedCoords;

    const map = window.L.map('pinning-map-leaflet').setView(
      [seed.latitude, seed.longitude],
      15
    );
    mapRef.current = map;

    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    let marker = window.L.marker([seed.latitude, seed.longitude], {
      draggable: true,
    }).addTo(map);
    markerRef.current = marker;

    // Map click handler
    map.on('click', (e) => {
      const { lat, lng } = e.latlng;
      setPinnedCoords({ latitude: lat, longitude: lng });
      marker.setLatLng([lat, lng]);
    });

    // Marker drag handler
    marker.on('dragend', () => {
      const { lat, lng } = marker.getLatLng();
      setPinnedCoords({ latitude: lat, longitude: lng });
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [visible, leafletLoaded]);

  // 5. Handle Geocoding Search via Nominatim
  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=ph&limit=5`
      );
      const results = await res.json();
      setSearchResults(Array.isArray(results) ? results : []);
      setShowResults(true);
    } catch (err) {
      console.warn('[MapPinningModal] Search error:', err);
    } finally {
      setSearching(false);
    }
  };

  const handleSelectSearchResult = (item) => {
    const lat = parseFloat(item.lat);
    const lon = parseFloat(item.lon);
    if (isNaN(lat) || isNaN(lon)) return;

    const coords = { latitude: lat, longitude: lon };
    setPinnedCoords(coords);
    setAddressName(item.display_name || item.name);
    setShowResults(false);
    setSearchQuery(item.display_name || item.name);

    if (mapRef.current && markerRef.current) {
      mapRef.current.setView([lat, lon], 16);
      markerRef.current.setLatLng([lat, lon]);
    }
  };

  const handleConfirm = () => {
    onConfirm({
      latitude: pinnedCoords.latitude,
      longitude: pinnedCoords.longitude,
      address: addressName,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Pin Your Location</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.close}>Cancel</Text>
          </TouchableOpacity>
        </View>

        {/* Search Bar at Top */}
        <View style={styles.searchContainer}>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search place, street, or city..."
              value={searchQuery}
              onChangeText={(text) => {
                setSearchQuery(text);
                if (!text) setShowResults(false);
              }}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
            />
            {searchQuery ? (
              <TouchableOpacity
                onPress={() => {
                  setSearchQuery('');
                  setShowResults(false);
                }}
                style={styles.clearBtn}
              >
                <Text style={styles.clearBtnText}>✕</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.searchBtn} onPress={handleSearch} disabled={searching}>
              {searching ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.searchBtnText}>Search</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Floating Search Results Dropdown */}
          {showResults && (
            <View style={styles.resultsDropdown}>
              {searchResults.length === 0 ? (
                <Text style={styles.noResults}>No matching places found.</Text>
              ) : (
                searchResults.map((item, idx) => (
                  <TouchableOpacity
                    key={item.place_id || idx}
                    style={styles.resultItem}
                    onPress={() => handleSelectSearchResult(item)}
                  >
                    <Text style={styles.resultText} numberOfLines={2}>
                      📍 {item.display_name}
                    </Text>
                  </TouchableOpacity>
                ))
              )}
            </View>
          )}
        </View>

        {/* Map Container & Floating Buttons */}
        <View style={styles.mapContainer}>
          <div id="pinning-map-leaflet" style={{ width: '100%', height: '100%', borderRadius: '12px' }} />

          {/* Floating Locate Me Button */}
          <TouchableOpacity
            style={styles.locateBtn}
            onPress={handleDetectLocation}
            disabled={detectingLocation}
          >
            {detectingLocation ? (
              <ActivityIndicator color={PRIMARY} size="small" />
            ) : (
              <Text style={styles.locateBtnText}>📍 My Location</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.addressLabel}>Selected Address:</Text>
          {loadingAddress ? (
            <ActivityIndicator size="small" color={PRIMARY} style={{ marginVertical: 8 }} />
          ) : (
            <Text style={styles.addressText}>{addressName}</Text>
          )}

          <TouchableOpacity style={styles.btn} onPress={handleConfirm}>
            <Text style={styles.btnText}>Confirm Location Pin</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: 48 },
  title: { fontSize: rf(20), fontWeight: '700', color: PRIMARY },
  close: { color: '#c62828', fontSize: rf(16), fontWeight: '600' },

  searchContainer: { paddingHorizontal: 16, marginBottom: 8, zIndex: 999 },
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0f0f0', borderRadius: 8, paddingHorizontal: 8 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: rf(14), color: '#222' },
  clearBtn: { padding: 8 },
  clearBtnText: { color: '#888', fontSize: rf(14), fontWeight: 'bold' },
  searchBtn: { backgroundColor: PRIMARY, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 6, marginLeft: 4 },
  searchBtnText: { color: '#fff', fontWeight: '600', fontSize: rf(13) },

  resultsDropdown: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    marginTop: 4,
    maxHeight: 180,
    overflow: 'scroll',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  resultItem: { padding: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  resultText: { fontSize: rf(13), color: '#333' },
  noResults: { padding: 12, fontSize: rf(13), color: '#888', fontStyle: 'italic', textAlign: 'center' },

  mapContainer: { flex: 1, marginHorizontal: 16, marginBottom: 12, borderRadius: 12, overflow: 'hidden', backgroundColor: '#f9f9f9', minHeight: 280, position: 'relative' },
  locateBtn: { position: 'absolute', top: 12, right: 12, backgroundColor: '#fff', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#ddd', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 3, zIndex: 1000 },
  locateBtnText: { color: PRIMARY, fontWeight: '700', fontSize: rf(13) },

  footer: { padding: 16, borderTopWidth: 1, borderColor: '#eee', backgroundColor: '#fafafa' },
  addressLabel: { fontSize: rf(13), fontWeight: '700', color: '#555' },
  addressText: { fontSize: rf(14), color: '#222', marginVertical: 6, lineHeight: 20 },
  btn: { backgroundColor: PRIMARY, paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: rf(16) },
});
