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

import { Colors } from '@/constants/theme';

SplashScreen.preventAutoHideAsync();

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
    <ThemeProvider value={DefaultTheme}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.background },
        }}>
        <Stack.Screen name="start" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </ThemeProvider>
  );
}
