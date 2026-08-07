import { rf } from '../lib/responsive';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';

// Header icon-button that opens the Profile screen. Uses useNavigation so it
// can be dropped into any dashboard header without threading the navigation
// prop through. Matches the emoji icon-button style of MessagesButton/NotificationBell.
export default function ProfileButton() {
  const navigation = useNavigation();
  return (
    <TouchableOpacity
      style={styles.iconBtn}
      onPress={() => navigation.navigate('Profile')}
      activeOpacity={0.7}
    >
      <Text style={styles.icon}>👤</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  iconBtn: { padding: 6, marginRight: 2 },
  icon: { fontSize: rf(20) },
});
