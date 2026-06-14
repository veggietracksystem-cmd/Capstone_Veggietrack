import { useState, useEffect, useCallback } from 'react';
import {
  Text, View, FlatList, TouchableOpacity,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../api/client';
import EmptyState from '../components/EmptyState';
import { showAlert, confirmAction } from '../lib/ui';

const PRIMARY = '#2e7d32';

// Emoji "illustration" per vegetable — substring match, falls back to a leafy green.
const VEG_ICONS = { tomato: '🍅', eggplant: '🍆', squash: '🎃', carrot: '🥕', potato: '🥔', corn: '🌽', pepper: '🌶️', cucumber: '🥒', onion: '🧅', lettuce: '🥬' };
function getVegetableIcon(name) {
  const key = String(name || '').toLowerCase();
  const match = Object.keys(VEG_ICONS).find((k) => key.includes(k));
  return match ? VEG_ICONS[match] : '🥬';
}

function statusBadgeStyle(status) {
  switch (status) {
    case 'available': return { backgroundColor: '#e8f5e9', borderColor: PRIMARY };
    case 'reserved': return { backgroundColor: '#fff8e1', borderColor: '#f9a825' };
    case 'picked_up': return { backgroundColor: '#eceff1', borderColor: '#607d8b' };
    default: return { backgroundColor: '#eee', borderColor: '#aaa' };
  }
}

export default function HarvestListScreen({ navigation }) {
  const [harvests, setHarvests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const loadHarvests = useCallback(async () => {
    try {
      const data = await api.get('/api/harvests');
      setHarvests(Array.isArray(data) ? data : []);
    } catch (err) {
      showAlert('Error', err.message);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadHarvests();
      setLoading(false);
    })();
  }, [loadHarvests]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadHarvests();
    setRefreshing(false);
  };

  // Edit reuses the Farmer dashboard's add/edit form via a navigation param.
  const editHarvest = (harvest) => {
    navigation.navigate('FarmerDashboard', { editHarvest: harvest });
  };

  const deleteHarvest = (harvest) => {
    confirmAction(
      'Delete Harvest',
      `Remove ${harvest.vegetable_name} (${harvest.quantity_kg}kg)? This can’t be undone.`,
      async () => {
        setBusyId(harvest.id);
        try {
          await api.delete(`/api/harvests/${harvest.id}`);
          setHarvests((prev) => prev.filter((h) => h.id !== harvest.id));
        } catch (err) {
          showAlert('Error', err.message);
        } finally {
          setBusyId(null);
        }
      }
    );
  };

  const requestPickup = async (harvest) => {
    setBusyId(harvest.id);
    try {
      await api.post('/api/pickup-requests', { harvest_id: harvest.id, note: null });
      showAlert('Pickup Requested', `Distributors have been notified for ${harvest.vegetable_name} (${harvest.quantity_kg}kg).`);
    } catch (err) {
      showAlert('Error', err.message);
    } finally {
      setBusyId(null);
    }
  };

  const renderItem = ({ item: h }) => {
    const busy = busyId === h.id;
    return (
      <View style={styles.recordCard}>
        <View style={styles.recordInfo}>
          <Text style={styles.icon}>{getVegetableIcon(h.vegetable_name)}</Text>
          <Text style={styles.recordVeg}>{h.vegetable_name}</Text>
          <Text style={styles.recordMeta}>{h.quantity_kg} kg</Text>
          <View style={[styles.statusBadge, statusBadgeStyle(h.status)]}>
            <Text style={styles.statusBadgeText}>{h.status}</Text>
          </View>
        </View>
        <View style={styles.recordActions}>
          <TouchableOpacity style={styles.smallBtn} onPress={() => editHarvest(h)} disabled={busy}>
            <Text style={styles.smallBtnText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.smallBtn} onPress={() => requestPickup(h)} disabled={busy}>
            <Text style={styles.smallBtnText}>Request Pickup</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.smallBtn, styles.deleteBtn]} onPress={() => deleteHarvest(h)} disabled={busy}>
            {busy
              ? <ActivityIndicator color="#c62828" size="small" />
              : <Text style={styles.deleteBtnText}>Delete</Text>}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>All Harvests</Text>
        <View style={{ width: 50 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      ) : (
        <FlatList
          data={harvests}
          keyExtractor={(h) => String(h.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <EmptyState
              icon="🥬"
              title="No harvests yet"
              message="Log a harvest from your dashboard so distributors can request a pickup."
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16, paddingBottom: 40, flexGrow: 1 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  back: { color: PRIMARY, fontSize: 16, fontWeight: '600', width: 50 },
  title: { fontSize: 20, fontWeight: 'bold', color: PRIMARY },

  recordCard: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
  recordInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  icon: { fontSize: 22 },
  recordVeg: { fontSize: 16, fontWeight: '700', color: '#222' },
  recordMeta: { fontSize: 14, color: '#555' },
  statusBadge: { paddingVertical: 2, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1 },
  statusBadgeText: { fontSize: 12, color: '#333' },

  recordActions: { flexDirection: 'row', gap: 10, marginTop: 12, flexWrap: 'wrap' },
  smallBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: PRIMARY },
  smallBtnText: { color: PRIMARY, fontWeight: '600', fontSize: 13 },
  deleteBtn: { borderColor: '#c62828' },
  deleteBtnText: { color: '#c62828', fontWeight: '600', fontSize: 13 },
});
