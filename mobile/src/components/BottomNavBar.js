import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fonts } from '../theme/appTheme';

export default function BottomNavBar({ tabs, activeTab, onTabPress }) {
  if (!tabs || !Array.isArray(tabs)) return null;
  return (
    <View style={styles.container}>
      {tabs.map((tab) => {
        if (tab.render) {
          // Custom tab content (e.g. NotificationBell) manages its own
          // press handling/state, so it's rendered as-is, not wrapped in
          // another TouchableOpacity.
          return (
            <View key={tab.id} style={styles.tabItem}>
              {tab.render(onTabPress, activeTab)}
            </View>
          );
        }
        const isActive = activeTab === tab.id;
        const IconComponent = tab.iconSet === 'material' ? MaterialCommunityIcons : Ionicons;
        return (
          <TouchableOpacity
            key={tab.id}
            style={styles.tabItem}
            onPress={() => onTabPress(tab)}
            activeOpacity={0.7}
          >
            <IconComponent
              name={tab.iconName}
              size={21}
              color={isActive ? colors.leaf700 : colors.inkFaint}
            />
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
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 10,
    paddingBottom: Platform.OS === 'ios' ? 24 : 10,
    height: Platform.OS === 'ios' ? 84 : 74,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  label: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    color: colors.inkFaint,
  },
  labelActive: {
    color: colors.leaf700,
  },
});
