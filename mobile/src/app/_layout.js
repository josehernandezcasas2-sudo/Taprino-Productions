import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: '#161005' },
          headerTintColor: '#f5e9d3',
          tabBarStyle: { backgroundColor: '#161005' },
          tabBarActiveTintColor: '#e8b923',
          tabBarInactiveTintColor: '#8a7f6a'
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Home' }} />
        <Tabs.Screen name="discover" options={{ title: 'Pitch Room' }} />
        <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      </Tabs>
    </SafeAreaProvider>
  );
}
