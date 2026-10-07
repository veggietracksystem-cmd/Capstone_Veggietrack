import { rf } from '../lib/responsive';
import { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fonts, typography } from '../theme/appTheme';
import CountBadge, { formatCount } from './ui/CountBadge';

// Bar padding without a system inset; the device's bottom inset is added on top.
const BASE_PADDING_BOTTOM = 10;
const BASE_HEIGHT = 74;

// Height of the floating bar including the bottom inset, so screens can keep
// their last item clear of it.
export function useBottomNavHeight() {
  return BASE_HEIGHT + useSafeAreaInsets().bottom;
}
// Scroll padding for content that sits above the bar, with a 16px gap.
export function useBottomNavSpace() {
  return useBottomNavHeight() + 16;
}

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

  if (!formatCount(count)) return null;
  return (
    <View style={styles.badge} pointerEvents="none">
      <Animated.View style={{ transform: [{ scale }] }}>
        <CountBadge count={count} max={99} />
      </Animated.View>
    </View>
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
          // Custom tab content (e.g. NotificationBell) handles its own presses.
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
            <View style={styles.iconWrap}>
              <IconComponent
                name={tab.iconName}
                size={rf(21)}
                color={isActive ? colors.leaf700 : colors.inkFaint}
              />
              {typeof tab.badge === 'number' && <TabBadge count={tab.badge} />}
            </View>
            {/* A long label wraps to a second line at the same size
                instead of being cut off on narrow phones. */}
            <Text
              style={[styles.label, isActive && styles.labelActive]}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
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
    boxShadow: '0 -1px 2px rgba(30, 78, 9, 0.06)',
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  // Top-aligned so every icon sits on the same line whether its label takes one
  // line or two; paddingTop keeps one-line tabs where they were when centered.
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 6,
    gap: 3,
  },
  iconWrap: {
    minHeight: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...typography.navLabel,
    color: colors.inkFaint,
    lineHeight: 14,
    textAlign: 'center',
    maxWidth: '100%',
    paddingHorizontal: 2,
  },
  labelActive: {
    color: colors.leaf700,
  },
  // Placement over the tab icon; the look comes from CountBadge. The fixed width
  // lets "12" or "99+" widen the badge: an absolute box at left 50% of the narrow
  // icon would otherwise squeeze it to the icon's width.
  badge: {
    position: 'absolute',
    top: -8,
    left: '50%',
    marginLeft: 4,
    width: 40,
    alignItems: 'flex-start',
  },
});
