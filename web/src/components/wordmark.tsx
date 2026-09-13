import { Link } from 'expo-router';
import { Image, Pressable } from 'react-native';

// Source is 788x182 (media/Scallion Logo.png, trimmed) — kept as one constant so every
// size below scales from the same aspect ratio instead of guessing per-use dimensions.
const LOGO_ASPECT = 788 / 182;

const SIZES = {
  small: { height: 28 },
  large: { height: 64 },
} as const;

/** The mark itself; `Wordmark` below wraps this in a link to Home for every header use. */
function Mark({ size = 'small' }: { size?: keyof typeof SIZES }) {
  const height = SIZES[size].height;
  return (
    <Image
      source={require('@/assets/images/scallion/logo.png')}
      accessibilityLabel="Scallion"
      resizeMode="contain"
      style={{ height, width: height * LOGO_ASPECT }}
    />
  );
}

/** Tapping the wordmark returns Home from anywhere, like every screen's own title usually would. */
export function Wordmark({ size = 'small', linkToHome = true }: { size?: keyof typeof SIZES; linkToHome?: boolean }) {
  if (!linkToHome) return <Mark size={size} />;
  return (
    <Link href="/" asChild>
      <Pressable accessibilityRole="link" accessibilityLabel="Scallion, go to Home" hitSlop={8}>
        <Mark size={size} />
      </Pressable>
    </Link>
  );
}
