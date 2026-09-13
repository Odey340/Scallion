import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { HeaderAuthButton } from '@/components/header-auth-button';
import { Wordmark } from '@/components/wordmark';
import { Colors, Fonts, GlassBlur } from '@/constants/theme';

type IconName = keyof typeof Ionicons.glyphMap;

const TAB_ICONS: Record<string, IconName> = {
  index: 'body-outline',
  circle: 'people-outline',
  labs: 'flask-outline',
  camera: 'camera-outline',
  scan: 'scan-outline',
  coach: 'mic-outline',
};

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: true,
        headerTitle: () => <Wordmark />,
        headerRight: () => <HeaderAuthButton />,
        headerStyle: { backgroundColor: Colors.surface, ...GlassBlur },
        headerShadowVisible: false,
        headerTintColor: Colors.text,
        sceneStyle: { backgroundColor: 'transparent' },
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
          ...GlassBlur,
        },
        tabBarLabelStyle: {
          fontFamily: Fonts.bodyMedium,
          fontSize: 11,
        },
        tabBarIcon: ({ color, size }) => (
          <Ionicons name={TAB_ICONS[route.name] ?? 'ellipse-outline'} color={color} size={size} />
        ),
      })}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="circle" options={{ title: 'Circle' }} />
      <Tabs.Screen name="labs" options={{ title: 'Labs' }} />
      <Tabs.Screen name="camera" options={{ title: 'Camera' }} />
      <Tabs.Screen name="scan" options={{ title: 'Scan' }} />
      <Tabs.Screen name="coach" options={{ title: 'Coach' }} />
    </Tabs>
  );
}
