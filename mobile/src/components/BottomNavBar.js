import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';

const PRIMARY = '#2e7d32';

export default function BottomNavBar({ tabs, activeTab, onTabPress }) {
  if (!tabs || !Array.isArray(tabs)) return null;
  return (
    <View style={styles.container}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <TouchableOpacity
            key={tab.id}
            style={styles.tabItem}
            onPress={() => onTabPress(tab)}
            activeOpacity={0.7}
          >
            <Text style={[styles.icon, isActive && styles.iconActive]}>
              {tab.icon}
            </Text>
            <Text
              style={[styles.label, isActive && styles.labelActive]}
              numberOfLines={1}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    paddingVertical: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 20,
    marginBottom: 2,
    color: '#757575',
  },
  iconActive: {
    transform: [{ scale: 1.1 }],
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
    color: '#757575',
  },
  labelActive: {
    color: PRIMARY,
    fontWeight: '700',
  },
});
