import { rf } from '../lib/responsive';
import { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fonts } from '../theme/appTheme';

// Base padding/height for the bar's own content (icons + labels) on a
// device with no bottom system inset. The device's actual bottom inset
// (home indicator / gesture or button nav area) is added on top of this,
// so the bar always clears the system navigation area instead of sitting
// under it or leaving a fixed, device-mismatched gap above it.
const BASE_PADDING_BOTTOM = 10;
const BASE_HEIGHT = 74;

// Small count badge shown on a tab's icon (e.g. cart item count). Bumps with
// a quick pop animation whenever the count goes up, so adding an item feels
// immediately reflected here.
function TabBadge({ count }) {
  const scale = useRef(new Animated.Value(1)).current;
  const prevCount = useRef(count);

  useEffect(() => {
    if (count > prevCount.current) {
      scale.setValue(1.4);
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 4 }).start();
    }
    prevCount.current = count;
  }, [count, scale]);

  if (!count) return null;
  return (
    <Animated.View style={[styles.badge, { transform: [{ scale }] }]}>
      <Text style={styles.badgeText} numberOfLines={1}>{count > 99 ? '99+' : count}</Text>
    </Animated.View>
  );
}

export default function BottomNavBar({ tabs, activeTab, onTabPress, onTabMeasure }) {
  const tabRefs = useRef({});
  const insets = useSafeAreaInsets();

  if (!tabs || !Array.isArray(tabs)) return null;

  const reportMeasure = (tabId) => {
    if (!onTabMeasure) return;
    const node = tabRefs.current[tabId];
    if (node && typeof node.measureInWindow === 'function') {
      node.measureInWindow((x, y, width, height) => onTabMeasure(tabId, { x, y, width, height }));
    }
  };

  return (
    <View
      style={[
        styles.container,
        { height: BASE_HEIGHT + insets.bottom, paddingBottom: BASE_PADDING_BOTTOM + insets.bottom },
      ]}
    >
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
            ref={(el) => { tabRefs.current[tab.id] = el; }}
            style={styles.tabItem}
            onPress={() => onTabPress(tab)}
            onLayout={() => reportMeasure(tab.id)}
            activeOpacity={0.7}
          >
            <View>
              <IconComponent
                name={tab.iconName}
                size={rf(21)}
                color={isActive ? colors.leaf700 : colors.inkFaint}
              />
              {typeof tab.badge === 'number' && <TabBadge count={tab.badge} />}
            </View>
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
    paddingTop: 10,
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
    fontSize: rf(11),
    color: colors.inkFaint,
  },
  labelActive: {
    color: colors.leaf700,
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: fonts.bodyBold,
    fontSize: rf(9.5),
    color: '#fff',
  },
});
