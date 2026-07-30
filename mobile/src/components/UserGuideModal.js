import { useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView,
} from 'react-native';

const PRIMARY = '#2e7d32';

const GUIDE_TABS = [
  { id: 'farmer', label: '👨‍🌾 Farmer', title: 'Farmer Workflow' },
  { id: 'distributor', label: '🏢 Distributor', title: 'Distributor Workflow' },
  { id: 'retailer', label: '🛒 Retailer', title: 'Retailer Workflow' },
  { id: 'rider', label: '🛵 Delivery', title: 'Rider Workflow' },
  { id: 'faq', label: '❓ FAQ', title: 'Frequently Asked Questions' },
];

const FAQS = [
  {
    q: 'What is the First-In, First-Out (FIFO) system?',
    a: 'VeggieTrack automatically sorts available crops by their harvest dates (oldest first). This encourages retailers to buy older stock first, reducing food spoilage and waste.'
  },
  {
    q: 'How does offline mode work?',
    a: 'Farmers can log harvests even without internet access. Actions are saved locally to your device and automatically synced with the backend server once reconnected.'
  },
  {
    q: 'What happens if an order is cancelled?',
    a: 'When a retailer cancels an unapproved order, the product stock is immediately restored back to the distributor’s available inventory.'
  },
  {
    q: 'Why can there only be one Distributor account?',
    a: 'VeggieTrack is designed as a hub-and-spoke central supply chain. The distributor acts as the central warehouse receiving produce from multiple farmers and supplying multiple retailers.'
  },
  {
    q: 'How does order tracking work?',
    a: 'Once a distributor approves a retailer order and assigns a rider, the Retailer can click "Track Delivery" to view route pins on an embedded map.'
  }
];

export default function UserGuideModal({ visible, onClose }) {
  const [activeTab, setActiveTab] = useState('farmer');
  const [expandedFaq, setExpandedFaq] = useState(null);

  const toggleFaq = (index) => {
    setExpandedFaq(expandedFaq === index ? null : index);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>📖 How VeggieTrack Works</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Role Tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar}>
            {GUIDE_TABS.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <TouchableOpacity
                  key={tab.id}
                  style={[styles.tab, active && styles.tabActive]}
                  onPress={() => setActiveTab(tab.id)}
                >
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Content Body */}
          <ScrollView contentContainerStyle={styles.content}>
            {activeTab === 'farmer' && (
              <View style={styles.stepContainer}>
                <View style={styles.stepCard}>
                  <Text style={styles.stepNum}>1</Text>
                  <View style={styles.stepInfo}>
                    <Text style={styles.stepTitle}>Record Harvest Batch</Text>
                    <Text style={styles.stepDesc}>Enter vegetable name, quantity in kilograms, and pin your farm coordinates on the map.</Text>
                  </View>
                </View>
                <View style={styles.stepCard}>
                  <Text style={styles.stepNum}>2</Text>
                  <View style={styles.stepInfo}>
                    <Text style={styles.stepTitle}>Request Pickup</Text>
                    <Text style={styles.stepDesc}>Click "Request Pickup" to notify the central distributor to collect your produce.</Text>
                  </View>
                </View>
                <View style={styles.stepCard}>
                  <Text style={styles.stepNum}>3</Text>
                  <View style={styles.stepInfo}>
                    <Text style={styles.stepTitle}>Marked Picked Up</Text>
                    <Text style={styles.stepDesc}>Once the delivery rider collects the batch, it updates to "Picked Up" and stays recorded in your history.</Text>
                  </View>
                </View>
              </View>
            )}

            {activeTab === 'distributor' && (
              <View style={styles.stepContainer}>
                <View style={styles.stepCard}>
                  <Text style={styles.stepNum}>1</Text>
                  <View style={styles.stepInfo}>
                    <Text style={styles.stepTitle}>Inventory Intake</Text>
                    <Text style={styles.stepDesc}>Approve incoming farmer harvest pickups and set product prices to add produce into warehouse inventory.</Text>
                  </View>
                </View>
                <View style={styles.stepCard}>
                  <Text style={styles.stepNum}>2</Text>
                  <View style={styles.stepInfo}>
                    <Text style={styles.stepTitle}>Approve & Assign Riders</Text>
                    <Text style={styles.stepDesc}>Review pending retailer orders, approve them, and assign an available delivery personnel (rider).</Text>
                  </View>
                </View>
                <View style={styles.stepCard}>
                  <Text style={styles.stepNum}>3</Text>
                  <View style={styles.stepInfo}>
                    <Text style={styles.stepTitle}>Payment & Analytics</Text>
                    <Text style={styles.stepDesc}>Record retailer payments and view 7-day business revenue and inventory reports.</Text>
                  </View>
                </View>
              </View>
            )}

            {activeTab === 'retailer' && (
              <View style={styles.stepContainer}>
                <View style={styles.stepCard}>
                  <Text style={styles.stepNum}>1</Text>
                  <View style={styles.stepInfo}>
                    <Text style={styles.stepTitle}>Browse FIFO Stock</Text>
                    <Text style={styles.stepDesc}>Crops are listed oldest-first based on harvest dates to ensure freshness and reduce spoilage.</Text>
                  </View>
                </View>
                <View style={styles.stepCard}>
                  <Text style={styles.stepNum}>2</Text>
                  <View style={styles.stepInfo}>
                    <Text style={styles.stepTitle}>Place Orders</Text>
                    <Text style={styles.stepDesc}>Select stock quantities in kg. Orders check stock availability instantly.</Text>
                  </View>
                </View>
                <View style={styles.stepCard}>
                  <Text style={styles.stepNum}>3</Text>
                  <View style={styles.stepInfo}>
                    <Text style={styles.stepTitle}>Track Delivery</Text>
                    <Text style={styles.stepDesc}>Once approved by the distributor, click "Track Delivery" to view rider route markers on the map.</Text>
                  </View>
                </View>
              </View>
            )}

            {activeTab === 'rider' && (
              <View style={styles.stepContainer}>
                <View style={styles.stepCard}>
                  <Text style={styles.stepNum}>1</Text>
                  <View style={styles.stepInfo}>
                    <Text style={styles.stepTitle}>View Assignments</Text>
                    <Text style={styles.stepDesc}>Check assigned farmer pickups and retailer deliveries from your delivery dashboard.</Text>
                  </View>
                </View>
                <View style={styles.stepCard}>
                  <Text style={styles.stepNum}>2</Text>
                  <View style={styles.stepInfo}>
                    <Text style={styles.stepTitle}>Embedded Map Routes</Text>
                    <Text style={styles.stepDesc}>Use embedded OpenStreetMap route pins for farm pickups, central warehouse, and retailer store locations.</Text>
                  </View>
                </View>
                <View style={styles.stepCard}>
                  <Text style={styles.stepNum}>3</Text>
                  <View style={styles.stepInfo}>
                    <Text style={styles.stepTitle}>Upload Proof of Delivery</Text>
                    <Text style={styles.stepDesc}>Advance status (Picked Up ➔ In Transit ➔ Delivered) and upload a proof photo upon completion.</Text>
                  </View>
                </View>
              </View>
            )}

            {activeTab === 'faq' && (
              <View style={styles.faqContainer}>
                {FAQS.map((faq, index) => {
                  const isOpen = expandedFaq === index;
                  return (
                    <TouchableOpacity
                      key={index}
                      style={styles.faqCard}
                      onPress={() => toggleFaq(index)}
                      activeOpacity={0.8}
                    >
                      <View style={styles.faqHeader}>
                        <Text style={styles.faqQuestion}>{faq.q}</Text>
                        <Text style={styles.faqToggle}>{isOpen ? '−' : '+'}</Text>
                      </View>
                      {isOpen && <Text style={styles.faqAnswer}>{faq.a}</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%', paddingBottom: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#eee' },
  title: { fontSize: 18, fontWeight: '700', color: PRIMARY },
  closeBtn: { padding: 6 },
  closeText: { fontSize: 18, color: '#777', fontWeight: 'bold' },
  tabBar: { flexDirection: 'row', paddingHorizontal: 16, marginVertical: 10 },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: '#f0f0f0', marginRight: 8 },
  tabActive: { backgroundColor: PRIMARY },
  tabText: { fontSize: 13, color: '#555', fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  content: { padding: 16 },
  stepContainer: { gap: 12 },
  stepCard: { flexDirection: 'row', backgroundColor: '#f8fdf8', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e8f5e9', alignItems: 'center' },
  stepNum: { width: 32, height: 32, borderRadius: 16, backgroundColor: PRIMARY, color: '#fff', textAlign: 'center', lineHeight: 32, fontWeight: 'bold', fontSize: 16, marginRight: 12 },
  stepInfo: { flex: 1 },
  stepTitle: { fontSize: 15, fontWeight: '700', color: '#222', marginBottom: 2 },
  stepDesc: { fontSize: 13, color: '#555', lineHeight: 18 },
  faqContainer: { gap: 10 },
  faqCard: { backgroundColor: '#fff', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#e0e0e0' },
  faqHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  faqQuestion: { fontSize: 14, fontWeight: '700', color: '#2e7d32', flex: 1, paddingRight: 8 },
  faqToggle: { fontSize: 18, fontWeight: 'bold', color: PRIMARY },
  faqAnswer: { marginTop: 8, fontSize: 13, color: '#555', lineHeight: 19 },
});
