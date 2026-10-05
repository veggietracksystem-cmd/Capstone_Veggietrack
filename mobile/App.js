import { View, ActivityIndicator, StyleSheet, Platform, Image, Easing } from 'react-native';
import { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { sharedScreenCardInterpolator, SCREEN_TRANSITION_DURATION } from './src/lib/motion';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold } from '@expo-google-fonts/poppins';
import { Ionicons } from '@expo/vector-icons';

import { AuthProvider, useAuth } from './src/context/AuthContext';
import { rootBranch, rootInitialRoute } from './src/lib/rootRoute';
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
import NotificationsScreen from './src/screens/NotificationsScreen';
import RiderNavigationScreen from './src/screens/delivery/RiderNavigationScreen';
import PickupNavigationScreen from './src/screens/delivery/PickupNavigationScreen';
import ChainReportScreen from './src/screens/ChainReportScreen';
import SpoiledProductsScreen from './src/screens/SpoiledProductsScreen';
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

const ROLE_SCREENS = {
  farmer: { name: 'FarmerDashboard', component: FarmerDashboard },
  distributor: { name: 'DistributorDashboard', component: DistributorDashboard },
  retailer: { name: 'RetailerDashboard', component: RetailerDashboard },
  delivery_personnel: { name: 'DeliveryDashboard', component: DeliveryDashboard },
};

function RootNavigator() {
  const { user, session, recoveryMode, loading, initialRoute, statusError } = useAuth();

  // Keep the spinner until the profile loads, so signing-in users never see the
  // account-status screen.
  const profilePending = !!session && !user && !recoveryMode && !statusError;

  if (loading || profilePending) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1E4E09" />
      </View>
    );
  }

  const roleScreen = (!recoveryMode && user?.access_allowed && user.role && ROLE_SCREENS[user.role]) ? ROLE_SCREENS[user.role] : null;
  // A single decision drives both the rendered branch and initialRouteName (see rootRoute.js).
  const branch = rootBranch({ recoveryMode, session, roleScreen });
  const initialRouteName = rootInitialRoute({ recoveryMode, session, roleScreen, initialRoute });

  return (
    <NavigationContainer>
      <Stack.Navigator
        // A new branch starts fresh at its own initial screen. Without this, leaving
        // password recovery kept the user on ResetPassword (also in the signed-out
        // branch) with no screen to go back to.
        key={branch}
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
        initialRouteName={initialRouteName}
      >
        {branch === 'recovery' ? <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} /> : branch === 'status' ? (<Stack.Screen name="ApplicationStatus" component={ApplicationStatusScreen}/>) : branch === 'role' ? (
          <>
            <Stack.Screen name={roleScreen.name} component={roleScreen.component} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
            {user.role === 'distributor' && <Stack.Screen name="AccountManagement" component={AccountManagementScreen} />}
            <Stack.Screen name="EditProfile" component={EditProfileScreen} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
            <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
            <Stack.Screen name="OrderTracking" component={OrderTrackingScreen} />
            <Stack.Screen name="OrderConfirmation" component={OrderConfirmationScreen} />
            <Stack.Screen name="OrderHistory" component={OrderHistoryScreen} />
            <Stack.Screen name="OrderDetails" component={OrderDetailsScreen} />
            <Stack.Screen name="HarvestList" component={HarvestListScreen} />
            <Stack.Screen name="ProductList" component={ProductListScreen} />
            <Stack.Screen name="Stocks" component={StocksScreen} />
            <Stack.Screen name="DistributorInventoryReport" component={DistributorInventoryReportScreen} />
            <Stack.Screen name="ChainReport" component={ChainReportScreen} />
            <Stack.Screen name="SpoiledProducts" component={SpoiledProductsScreen} />
            <Stack.Screen name="DeliveryDetails" component={DeliveryDetailsScreen} />
            <Stack.Screen name="RiderNavigation" component={RiderNavigationScreen} />
            <Stack.Screen name="PickupNavigation" component={PickupNavigationScreen} />
            <Stack.Screen name="ShopeeTracking" component={ShopeeTrackingScreen} />
            <Stack.Screen name="ManageAddresses" component={ManageAddressesScreen} />
            <Stack.Screen name="FarmerPickupTracking" component={FarmerPickupTrackingScreen} />
            {/* Distributor/Retailer/Delivery: pushed from the header Messages icon.
                Farmer instead embeds MessagesScreen as a bottom tab. */}
            <Stack.Screen name="Messages" component={MessagesScreen} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
          </>
        ) : (
          <>
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
