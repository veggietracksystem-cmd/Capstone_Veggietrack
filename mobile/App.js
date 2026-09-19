import { View, ActivityIndicator, StyleSheet, Platform, Image, Easing } from 'react-native';
import { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { sharedScreenCardInterpolator, SCREEN_TRANSITION_DURATION, SCREEN_TRANSITION_DISTANCE } from './src/lib/motion';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold } from '@expo-google-fonts/poppins';
import { Ionicons } from '@expo/vector-icons';

import { AuthProvider, useAuth } from './src/context/AuthContext';
import { LanguageProvider } from './src/i18n/LanguageProvider';
import { SyncProvider } from './src/sync/SyncProvider';
import ErrorBoundary from './src/components/ErrorBoundary';
import AlertModalHost from './src/components/AlertModalHost';
import LandingScreen from './src/screens/LandingScreen';
import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import ApplicationStatusScreen from './src/screens/ApplicationStatusScreen';
import AccountManagementScreen from './src/screens/AccountManagementScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import ResetPasswordScreen from './src/screens/ResetPasswordScreen';
import VerifyEmailScreen from './src/screens/VerifyEmailScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import EditProfileScreen from './src/screens/EditProfileScreen';
import FarmerDashboard from './src/screens/FarmerDashboard';
import DistributorDashboard from './src/screens/DistributorDashboard';
import RetailerDashboard from './src/screens/RetailerDashboard';
import DeliveryDashboard from './src/screens/DeliveryDashboard';
import OrderTrackingScreen from './src/screens/OrderTrackingScreen';
import OrderConfirmationScreen from './src/screens/OrderConfirmationScreen';
import OrderHistoryScreen from './src/screens/OrderHistoryScreen';
import OrderDetailsScreen from './src/screens/OrderDetailsScreen';
import HarvestListScreen from './src/screens/HarvestListScreen';
import ProductListScreen from './src/screens/ProductListScreen';
import StocksScreen from './src/screens/StocksScreen';
import DistributorInventoryReportScreen from './src/screens/DistributorInventoryReportScreen';
import DeliveryDetailsScreen from './src/screens/DeliveryDetailsScreen';
import MessagesScreen from './src/screens/MessagesScreen';
import RiderNavigationScreen from './src/screens/delivery/RiderNavigationScreen';
import ShopeeTrackingScreen from './src/screens/Retailer/ShopeeTrackingScreen';
import ManageAddressesScreen from './src/screens/ManageAddressesScreen';
import FarmerPickupTrackingScreen from './src/screens/FarmerPickupTrackingScreen';

const Stack = createStackNavigator();

const REQUIRED_FONT_FAMILIES = [
  'Poppins_400Regular',
  'Poppins_500Medium',
  'Poppins_600SemiBold',
  'Poppins_700Bold',
  'ionicons',
];
const PUBLIC_LOGO_ASSET = require('./assets/new_logo.png');

// Maps backend role strings to their dashboard component + route name.
const ROLE_SCREENS = {
  farmer: { name: 'FarmerDashboard', component: FarmerDashboard },
  distributor: { name: 'DistributorDashboard', component: DistributorDashboard },
  retailer: { name: 'RetailerDashboard', component: RetailerDashboard },
  delivery_personnel: { name: 'DeliveryDashboard', component: DeliveryDashboard },
};

// Reads auth state from context and renders the right stack.
function RootNavigator() {
  const { user, session, recoveryMode, loading, initialRoute } = useAuth();

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1E4E09" />
      </View>
    );
  }

  const roleScreen = (!recoveryMode && user?.access_allowed && user.role && ROLE_SCREENS[user.role]) ? ROLE_SCREENS[user.role] : null;

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          cardStyle: { flex: 1, backgroundColor: '#fff' },
          cardStyleInterpolator: sharedScreenCardInterpolator,
          transitionSpec: {
            open: {
              animation: 'timing',
              config: {
                duration: SCREEN_TRANSITION_DURATION,
                easing: Easing.out(Easing.quad),
              },
            },
            close: {
              animation: 'timing',
              config: {
                duration: SCREEN_TRANSITION_DURATION,
                easing: Easing.out(Easing.quad),
              },
            },
          },
          gestureDirection: 'horizontal',
        }}
        initialRouteName={roleScreen ? roleScreen.name : initialRoute}
      >
        {recoveryMode ? <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} /> : session && !roleScreen ? (<Stack.Screen name="ApplicationStatus" component={ApplicationStatusScreen}/>) : roleScreen ? (
          <>
            <Stack.Screen name={roleScreen.name} component={roleScreen.component} />
            {/* Reachable from a dashboard via navigation.navigate('Profile'/'EditProfile'). */}
            <Stack.Screen name="Profile" component={ProfileScreen} />
            {user.role === 'distributor' && <Stack.Screen name="AccountManagement" component={AccountManagementScreen} />}
            <Stack.Screen name="EditProfile" component={EditProfileScreen} />
            {/* Edit Profile -> Change password sends the emailed reset link from
                here; ResetPassword then handles the link when it reopens the app. */}
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
            <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
            {/* Retailer/Distributor: live delivery tracking on a map. */}
            <Stack.Screen name="OrderTracking" component={OrderTrackingScreen} />
            {/* Retailer: review delivery address/schedule + confirm before submitting an order. */}
            <Stack.Screen name="OrderConfirmation" component={OrderConfirmationScreen} />
            {/* Retailer: orders delivered more than 5 days ago. */}
            <Stack.Screen name="OrderHistory" component={OrderHistoryScreen} />
            {/* Retailer: full breakdown of a single order. */}
            <Stack.Screen name="OrderDetails" component={OrderDetailsScreen} />
            {/* Farmer: full harvest list (edit/delete/request pickup). 
                Unreachable via navigation - kept for potential later use. */}
            <Stack.Screen name="HarvestList" component={HarvestListScreen} />
            {/* Distributor: aggregated product list (price edit). 
                Kept for backward compatibility — Home now embeds this inline. */}
            <Stack.Screen name="ProductList" component={ProductListScreen} />
            {/* Distributor: received batches (FIFO stocks, add to product list). */}
            <Stack.Screen name="Stocks" component={StocksScreen} />
            {/* Distributor: inventory + weekly report, with History + PDF export. */}
            <Stack.Screen name="DistributorInventoryReport" component={DistributorInventoryReportScreen} />
            {/* Delivery personnel: full details for one assigned order. */}
            <Stack.Screen name="DeliveryDetails" component={DeliveryDetailsScreen} />
            {/* Rider: Grab-style navigation map (rider view). */}
            <Stack.Screen name="RiderNavigation" component={RiderNavigationScreen} />
            {/* Retailer/Distributor: Shopee-style tracking map (customer view). */}
            <Stack.Screen name="ShopeeTracking" component={ShopeeTrackingScreen} />
            {/* Manage Addresses - for all users (saved delivery addresses). */}
            <Stack.Screen name="ManageAddresses" component={ManageAddressesScreen} />
            <Stack.Screen name="FarmerPickupTracking" component={FarmerPickupTrackingScreen} />
            {/* Distributor/Retailer/Delivery: pushed from the header Messages icon.
                Farmer instead embeds MessagesScreen as a bottom tab. */}
            <Stack.Screen name="Messages" component={MessagesScreen} />
          </>
        ) : (
          <>
            {/* Landing is first so unauthenticated users see it before Login.
                Logged-in users render the role stack above and never reach it. */}
            <Stack.Screen name="Landing" component={LandingScreen} />
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
            <Stack.Screen name="CompleteProfile" component={RegisterScreen} />
            <Stack.Screen name="VerifyEmail" component={VerifyEmailScreen} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
            <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    ...Ionicons.font,
  });
  const [webFontsReady, setWebFontsReady] = useState(Platform.OS !== 'web');
  const [publicAssetsReady, setPublicAssetsReady] = useState(Platform.OS !== 'web');

  useEffect(() => {
    if (Platform.OS !== 'web' || !fontsLoaded) return undefined;

    let mounted = true;
    const waitForBrowserFonts = async () => {
      if (!document.fonts) {
        if (mounted) setWebFontsReady(true);
        return;
      }

      await Promise.all(REQUIRED_FONT_FAMILIES.map((family) => document.fonts.load(`16px "${family}"`)));
      if (mounted) setWebFontsReady(true);
    };

    waitForBrowserFonts().catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, [fontsLoaded]);

  const preloadLogo = Platform.OS === 'web' && !publicAssetsReady ? (
    <Image
      source={PUBLIC_LOGO_ASSET}
      style={styles.preloadImage}
      onLoad={() => setPublicAssetsReady(true)}
    />
  ) : null;

  if (!fontsLoaded || !webFontsReady || !publicAssetsReady) {
    return (
      <View style={styles.loadingContainer}>
        {preloadLogo}
        <ActivityIndicator size="large" color="#1E4E09" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <LanguageProvider>
          <AuthProvider>
            <SyncProvider>
              <RootNavigator />
              <AlertModalHost />
            </SyncProvider>
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
  preloadImage: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
});
