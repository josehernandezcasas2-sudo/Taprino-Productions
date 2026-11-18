import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { absoluteFill, colors, inkTint, surfaceTint } from '../../lib/theme';

// A sheet from the bottom for Messages (2026-11-18): New message (most of
// the screen, `fill`) and a conversation's ⋯ (as tall as it needs). The
// dimmed screen fades in, the sheet slides up; ×, the dimmed screen and
// Android's back button close it.
//
// A Modal of its own, with its own inset provider (a full-screen Modal is
// its own window on iOS; the root provider's values could lag a turn of
// the phone), every orientation allowed — an iOS Modal opened from a
// screen held sideways crashes without it. The keyboard pads the whole
// window (`behavior="padding"` on both platforms: an Expo app is
// edge-to-edge on Android, so the window no longer resizes for it), so the
// sheet shrinks above it instead of hiding under it.
const ORIENTATIONS = ['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right'];
// Wider than this (a tablet, a phone held sideways) the sheet is a column
// in the middle, not the whole width.
const WIDE_FROM = 600;
const MAX_WIDTH = 560;

export default function MessageSheet({ visible, onClose, label, fill = false, tone = 'raised', children }) {
  const [shown, setShown] = useState(visible);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible && !shown) { setShown(true); return; }
    if (visible && shown) {
      Animated.timing(anim, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      return;
    }
    if (!visible && shown) {
      Animated.timing(anim, { toValue: 0, duration: 170, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
        if (finished) setShown(false);
      });
    }
  }, [visible, shown, anim]);

  return (
    <Modal
      visible={shown}
      transparent
      animationType="none"
      onRequestClose={onClose}
      supportedOrientations={ORIENTATIONS}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <SafeAreaProvider style={absoluteFill}>
        {shown ? <SheetFrame anim={anim} onClose={onClose} label={label} fill={fill} tone={tone}>{children}</SheetFrame> : null}
      </SafeAreaProvider>
    </Modal>
  );
}

function SheetFrame({ anim, onClose, label, fill, tone, children }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardUp(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const wide = width >= WIDE_FROM;
  const panelWidth = wide ? Math.min(MAX_WIDTH, width - insets.left - insets.right - 24) : width;
  // New message takes most of the screen: the board's 96pt gap on a phone
  // held upright, a sliver on a short one (a phone held sideways).
  const topGap = insets.top + (height >= 600 ? 40 : 8);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [Math.min(height, 700), 0] });
  const sidePad = wide ? 0 : Math.max(insets.left, insets.right);

  return (
    <>
      <Animated.View style={[styles.backdrop, { opacity: anim }]}>
        <Pressable style={absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      </Animated.View>
      <KeyboardAvoidingView behavior="padding" style={styles.keyboard} pointerEvents="box-none">
        <Animated.View
          accessibilityViewIsModal
          accessibilityLabel={label}
          style={[
            styles.panel,
            tone === 'page' ? styles.panelPage : null,
            { width: panelWidth, paddingLeft: 16 + sidePad, paddingRight: 16 + sidePad, paddingBottom: keyboardUp ? 10 : 16 + insets.bottom },
            fill ? { flex: 1, marginTop: topGap } : { maxHeight: height - insets.top - 12 },
            { transform: [{ translateY }] }
          ]}
        >
          <View style={styles.grabber} />
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...absoluteFill, backgroundColor: surfaceTint(0.68) },
  keyboard: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  panel: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: inkTint(0.12),
    paddingTop: 10
  },
  panelPage: { backgroundColor: colors.surface0, borderColor: inkTint(0.14) },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: inkTint(0.25), marginBottom: 10 }
});
