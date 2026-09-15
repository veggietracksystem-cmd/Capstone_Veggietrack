import UserAvatar from './UserAvatar';
import { useAuth } from '../context/AuthContext';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';

// Header icon-button that opens the Profile screen. Uses useNavigation so it
// can be dropped into any dashboard header without threading the navigation
// prop through. Matches the emoji icon-button style of MessagesButton/NotificationBell.
export default function ProfileButton() {
  const navigation = useNavigation();
  const { user } = useAuth();
  return (
    <TouchableOpacity
      style={styles.iconBtn}
      onPress={() => navigation.navigate('Profile')}
      activeOpacity={0.7}
    >
      <UserAvatar user={user} size={26} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  iconBtn: { padding: 6, marginRight: 2 },
});
