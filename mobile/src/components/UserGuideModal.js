import { useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView,
} from 'react-native';
import { useTranslation } from '../i18n/useTranslation';

const PRIMARY = '#2e7d32';

const GUIDE_TAB_IDS = ['farmer', 'distributor', 'retailer', 'rider', 'faq'];

export default function UserGuideModal({ visible, onClose }) {
  const { t, tRaw } = useTranslation();
  const [activeTab, setActiveTab] = useState('farmer');
  const [expandedFaq, setExpandedFaq] = useState(null);

  const toggleFaq = (index) => {
    setExpandedFaq(expandedFaq === index ? null : index);
  };

  const farmerSteps = tRaw('userGuide.farmer.steps') || [];
  const distributorSteps = tRaw('userGuide.distributor.steps') || [];
  const retailerSteps = tRaw('userGuide.retailer.steps') || [];
  const riderSteps = tRaw('userGuide.rider.steps') || [];
  const faqs = tRaw('userGuide.faqs') || [];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>{t('userGuide.title')}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Role Tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar}>
            {GUIDE_TAB_IDS.map((id) => {
              const active = activeTab === id;
              return (
                <TouchableOpacity
                  key={id}
                  style={[styles.tab, active && styles.tabActive]}
                  onPress={() => setActiveTab(id)}
                >
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>
                    {t(`userGuide.tabs.${id}`)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Content Body */}
          <ScrollView contentContainerStyle={styles.content}>
            {activeTab === 'farmer' && (
              <View style={styles.stepContainer}>
                {farmerSteps.map((step, i) => (
                  <View style={styles.stepCard} key={i}>
                    <Text style={styles.stepNum}>{i + 1}</Text>
                    <View style={styles.stepInfo}>
                      <Text style={styles.stepTitle}>{step.title}</Text>
                      <Text style={styles.stepDesc}>{step.desc}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {activeTab === 'distributor' && (
              <View style={styles.stepContainer}>
                {distributorSteps.map((step, i) => (
                  <View style={styles.stepCard} key={i}>
                    <Text style={styles.stepNum}>{i + 1}</Text>
                    <View style={styles.stepInfo}>
                      <Text style={styles.stepTitle}>{step.title}</Text>
                      <Text style={styles.stepDesc}>{step.desc}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {activeTab === 'retailer' && (
              <View style={styles.stepContainer}>
                {retailerSteps.map((step, i) => (
                  <View style={styles.stepCard} key={i}>
                    <Text style={styles.stepNum}>{i + 1}</Text>
                    <View style={styles.stepInfo}>
                      <Text style={styles.stepTitle}>{step.title}</Text>
                      <Text style={styles.stepDesc}>{step.desc}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {activeTab === 'rider' && (
              <View style={styles.stepContainer}>
                {riderSteps.map((step, i) => (
                  <View style={styles.stepCard} key={i}>
                    <Text style={styles.stepNum}>{i + 1}</Text>
                    <View style={styles.stepInfo}>
                      <Text style={styles.stepTitle}>{step.title}</Text>
                      <Text style={styles.stepDesc}>{step.desc}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {activeTab === 'faq' && (
              <View style={styles.faqContainer}>
                {faqs.map((faq, index) => {
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
