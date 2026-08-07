import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold } from '@expo-google-fonts/poppins';

import { AuthProvider, useAuth } from './src/context/AuthContext';
import { LanguageProvider } from './src/i18n/LanguageProvider';
import ErrorBoundary from './src/components/ErrorBoundary';
import AlertModalHost from './src/components/AlertModalHost';
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
import OrderConfirmationScreen from './src/screens/OrderConfirmationScreen';
import OrderHistoryScreen from './src/screens/OrderHistoryScreen';
import OrderDetailsScreen from './src/screens/OrderDetailsScreen';
import HarvestListScreen from './src/screens/HarvestListScreen';
import ProductListScreen from './src/screens/ProductListScreen';
import StocksScreen from './src/screens/StocksScreen';
import DistributorInventoryReportScreen from './src/screens/DistributorInventoryReportScreen';
import DeliveryDetailsScreen from './src/screens/DeliveryDetailsScreen';
import MessagesScreen from './src/screens/MessagesScreen';

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
        <ActivityIndicator size="large" color="#1E4E09" />
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
            {/* Retailer: review delivery address/schedule + confirm before submitting an order. */}
            <Stack.Screen name="OrderConfirmation" component={OrderConfirmationScreen} />
            {/* Retailer: orders delivered more than 5 days ago. */}
            <Stack.Screen name="OrderHistory" component={OrderHistoryScreen} />
            {/* Retailer: full breakdown of a single order. */}
            <Stack.Screen name="OrderDetails" component={OrderDetailsScreen} />
            {/* Farmer: full harvest list (edit/delete/request pickup). Currently
                unreachable via navigation - Messages/Weekly-report/History/
                Ready-to-sell are now embedded tabs/sheets inside FarmerDashboard
                per the approved mockup, not pushed screens. Left registered in
                case it's wired up again later. */}
            <Stack.Screen name="HarvestList" component={HarvestListScreen} />
            {/* Distributor: aggregated product list (price edit). Kept registered
                for backward compatibility — Home now embeds this inline. */}
            <Stack.Screen name="ProductList" component={ProductListScreen} />
            {/* Distributor: received batches (FIFO stocks, add to product list). */}
            <Stack.Screen name="Stocks" component={StocksScreen} />
            {/* Distributor: inventory + weekly report, with History + PDF export. */}
            <Stack.Screen name="DistributorInventoryReport" component={DistributorInventoryReportScreen} />
            {/* Delivery personnel: full details for one assigned order. */}
            <Stack.Screen name="DeliveryDetails" component={DeliveryDetailsScreen} />
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
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
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
  });

  if (!fontsLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1E4E09" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <LanguageProvider>
          <AuthProvider>
            <RootNavigator />
            <AlertModalHost />
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
