import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FadeInUp } from '@/components/animated';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

export function PlaceholderScreen({
  title,
  description,
  contractRef,
}: {
  title: string;
  description: string;
  contractRef: string;
}) {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <FadeInUp>
          <ThemedText type="title">{title}</ThemedText>
          <ThemedText type="default" themeColor="textSecondary" style={styles.description}>
            {description}
          </ThemedText>
          <ThemedText type="small" themeColor="textMuted">
            {contractRef}
          </ThemedText>
        </FadeInUp>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  description: {
    marginTop: Spacing.one,
  },
});
