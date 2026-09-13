import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useLocalUser } from '@/state/local-identity';

/** Persistent header-right control on every screen: teleports to the sign-in page (/onboarding). */
export function HeaderAuthButton() {
  const router = useRouter();
  const user = useLocalUser();

  return (
    <Pressable style={user ? styles.secondary : styles.primary} onPress={() => router.push('/onboarding')}>
      <ThemedText type="small" themeColor={user ? 'text' : 'accentText'}>
        {user ? 'Account' : 'Sign in'}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primary: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    marginRight: Spacing.three,
  },
  secondary: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    marginRight: Spacing.three,
  },
});
