import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, useFonts as useInterFonts } from '@expo-google-fonts/inter';
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
  useFonts as useSpaceGroteskFonts,
} from '@expo-google-fonts/space-grotesk';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { View } from 'react-native';

import { HeaderAuthButton } from '@/components/header-auth-button';
import { PageGradient } from '@/components/page-gradient';
import { Wordmark } from '@/components/wordmark';
import { Colors } from '@/constants/theme';

SplashScreen.preventAutoHideAsync();

// React Navigation paints DefaultTheme.colors.background (#f2f2f2) behind every navigator as a base
// fallback, independent of any screen's own contentStyle — override just that one token so the page
// gradient (mounted below) isn't hidden under an opaque gray layer.
const AppTheme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: 'transparent' } };

export default function RootLayout() {
  const [interLoaded] = useInterFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  const [displayLoaded] = useSpaceGroteskFonts({ SpaceGrotesk_500Medium, SpaceGrotesk_700Bold });
  const fontsLoaded = interLoaded && displayLoaded;

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <ThemeProvider value={AppTheme}>
      <StatusBar style="dark" />
      <View style={{ flex: 1 }}>
        <PageGradient />
        <Stack
          screenOptions={{
            headerShown: true,
            headerTitle: () => <Wordmark />,
            headerRight: () => <HeaderAuthButton />,
            headerStyle: { backgroundColor: Colors.surface },
            headerShadowVisible: false,
            headerTintColor: Colors.text,
            headerBackTitle: '',
            contentStyle: { backgroundColor: Colors.background },
          }}>
          <Stack.Screen name="start" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="scan-results" />
          <Stack.Screen name="labs-results" />
        </Stack>
      </View>
    </ThemeProvider>
  );
}
