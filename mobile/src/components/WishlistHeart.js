import { Pressable, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../lib/theme';

const HEART = 'M12 21s-6.7-4.35-9.33-8.2C.86 10.1 1.3 6.6 4.1 4.9a5.4 5.4 0 0 1 7.1 1.2 5.4 5.4 0 0 1 7.1-1.2c2.8 1.7 3.24 5.2 1.43 7.9C18.7 16.65 12 21 12 21z';

// components/WishlistButton.js + .wishlist-btn: a 26px translucent circle,
// outlined heart when off, filled oxide (danger) heart and ring when on.
// Sits over a card's top-right corner; `top` lets a card shift it down to
// clear its "New episode" banner, same as the site's :has() rule.
export default function WishlistHeart({ active, onToggle, top = 8 }) {
  const tint = active ? colors.danger : colors.inkDim;
  return (
    <Pressable
      onPress={onToggle}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={active ? 'Remove from wishlist' : 'Add to wishlist'}
      style={[styles.btn, { top }, active && styles.btnActive]}
    >
      <Svg width={14} height={14} viewBox="0 0 24 24" fill={active ? tint : 'none'} stroke={tint} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Path d={HEART} />
      </Svg>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { position: 'absolute', right: 8, zIndex: 4, width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(251,232,211,0.25)', backgroundColor: 'rgba(10,10,14,0.55)', alignItems: 'center', justifyContent: 'center' },
  btnActive: { borderColor: colors.danger }
});
