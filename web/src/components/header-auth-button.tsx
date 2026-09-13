import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/state/auth-store';

/** Persistent header-right control on every screen: teleports to the sign-in page (/onboarding). */
export function HeaderAuthButton() {
  const router = useRouter();
  const { session, loading } = useSession();

  if (loading) return null;

  return (
    <Pressable style={session ? styles.secondary : styles.primary} onPress={() => router.push('/onboarding')}>
      <ThemedText type="small" themeColor={session ? 'text' : 'accentText'}>
        {session ? 'Account' : 'Sign in'}
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
