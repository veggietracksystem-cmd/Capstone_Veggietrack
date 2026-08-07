import { rf } from '../lib/responsive';
import { useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView,
} from 'react-native';
import { colors, fonts, radius } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';

const PRIMARY = colors.leaf700;

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
  backdrop: { flex: 1, backgroundColor: 'rgba(20,17,16,0.42)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bgScreen, borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: '85%', paddingBottom: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontFamily: fonts.heading, fontSize: rf(18), color: colors.ink },
  closeBtn: { padding: 6 },
  closeText: { fontSize: rf(18), color: colors.inkSoft, fontWeight: 'bold' },
  tabBar: { flexDirection: 'row', paddingHorizontal: 16, marginVertical: 10 },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: colors.leaf50, marginRight: 8 },
  tabActive: { backgroundColor: PRIMARY },
  tabText: { fontFamily: fonts.bodySemiBold, fontSize: rf(13), color: colors.inkSoft },
  tabTextActive: { color: '#fff' },
  content: { padding: 16 },
  stepContainer: { gap: 12 },
  stepCard: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.card, padding: 14, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  stepNum: { width: 32, height: 32, borderRadius: 16, backgroundColor: PRIMARY, color: '#fff', textAlign: 'center', lineHeight: 32, fontWeight: 'bold', fontSize: rf(16), marginRight: 12 },
  stepInfo: { flex: 1 },
  stepTitle: { fontFamily: fonts.bodyBold, fontSize: rf(14.5), color: colors.ink, marginBottom: 2 },
  stepDesc: { fontFamily: fonts.body, fontSize: rf(13), color: colors.inkSoft, lineHeight: 18 },
  faqContainer: { gap: 10 },
  faqCard: { backgroundColor: colors.card, borderRadius: radius.ctrl, padding: 14, borderWidth: 1, borderColor: colors.border },
  faqHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  faqQuestion: { fontFamily: fonts.bodyBold, fontSize: rf(14), color: PRIMARY, flex: 1, paddingRight: 8 },
  faqToggle: { fontSize: rf(18), fontWeight: 'bold', color: PRIMARY },
  faqAnswer: { fontFamily: fonts.body, marginTop: 8, fontSize: rf(13), color: colors.inkSoft, lineHeight: 19 },
});
