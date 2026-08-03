import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Baloo2_500Medium, Baloo2_600SemiBold, Baloo2_700Bold } from '@expo-google-fonts/baloo-2';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';

import { AuthProvider, useAuth } from './src/context/AuthContext';
import { LanguageProvider } from './src/i18n/LanguageProvider';
import ErrorBoundary from './src/components/ErrorBoundary';
import LandingScreen from './src/screens/LandingScreen';
import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import EditProfileScreen from './src/screens/EditProfileScreen';
import FarmerDashboard from './src/screens/FarmerDashboard';
import DistributorDashboard from './src/screens/DistributorDashboard';
import RetailerDashboard from './src/screens/RetailerDashboard';
import DeliveryDashboard from './src/screens/DeliveryDashboard';
import OrderTrackingScreen from './src/screens/OrderTrackingScreen';
import HarvestListScreen from './src/screens/HarvestListScreen';
import ProductListScreen from './src/screens/ProductListScreen';

const Stack = createStackNavigator();

// Maps backend role strings to their dashboard component + route name.
const ROLE_SCREENS = {
  farmer: { name: 'FarmerDashboard', component: FarmerDashboard },
  distributor: { name: 'DistributorDashboard', component: DistributorDashboard },
  retailer: { name: 'RetailerDashboard', component: RetailerDashboard },
  delivery_personnel: { name: 'DeliveryDashboard', component: DeliveryDashboard },
};

// Reads auth state from context and renders the right stack. Because this reads
// context, login/logout re-render it automatically — no manual reload needed.
function RootNavigator() {
  const { user, loading, initialRoute } = useAuth();

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2e7d32" />
      </View>
    );
  }

  const roleScreen = (user && user.role && ROLE_SCREENS[user.role]) ? ROLE_SCREENS[user.role] : null;

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{ headerShown: false, cardStyle: { flex: 1 } }}
        initialRouteName={roleScreen ? roleScreen.name : initialRoute}
      >
        {roleScreen ? (
          <>
            <Stack.Screen name={roleScreen.name} component={roleScreen.component} />
            {/* Reachable from a dashboard via navigation.navigate('Profile'/'EditProfile'). */}
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="EditProfile" component={EditProfileScreen} />
            {/* Retailer/Distributor: live delivery tracking on a map. */}
            <Stack.Screen name="OrderTracking" component={OrderTrackingScreen} />
            {/* Farmer: full harvest list (edit/delete/request pickup). Currently
                unreachable via navigation - Messages/Weekly-report/History/
                Ready-to-sell are now embedded tabs/sheets inside FarmerDashboard
                per the approved mockup, not pushed screens. Left registered in
                case it's wired up again later. */}
            <Stack.Screen name="HarvestList" component={HarvestListScreen} />
            {/* Distributor: full product list (edit/delete). */}
            <Stack.Screen name="ProductList" component={ProductListScreen} />
          </>
        ) : (
          <>
            {/* Landing is first so unauthenticated users see it before Login.
                Logged-in users render the role stack above and never reach it. */}
            <Stack.Screen name="Landing" component={LandingScreen} />
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Baloo2_500Medium,
    Baloo2_600SemiBold,
    Baloo2_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2e7d32" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <LanguageProvider>
          <AuthProvider>
            <RootNavigator />
          </AuthProvider>
        </LanguageProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
});
