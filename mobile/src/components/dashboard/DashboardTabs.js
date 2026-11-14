import { useRef } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAdminRole } from '../../lib/adminRole';
import { dashboardTabs } from '../../lib/creatorDashboardRules';
import { colors, fonts, inkTint } from '../../lib/theme';
import { hrefToRoute } from '../PushListener';

// The row of tabs across the creator screens (2026-11-14, with the
// Dashboard; the website's components/creator/DashboardTabs.js): Overview ·
// Your work · Numbers · Money · Pitches, and Creator Studio until Jose
// decides whether the Dashboard replaces it. Which tabs a person gets is
// lib/creatorDashboardRules.js dashboardTabs; someone with only Overview (a
// sub-admin who is not a creator, a host on the Money screen) gets no row.
//
// `current` is the tab of the screen it sits on: 'overview' | 'work' |
// 'numbers' | 'money' | 'pitches' | 'studio'. The row scrolls sideways and
// starts with the current tab in sight.
//
// Moving between them keeps the stack short: from the Dashboard a tab opens
// on top of it; from one of the others a tab takes that screen's place; and
// Overview goes back down to the Dashboard when it is open underneath (in
// this screen's place when it isn't). So Back from any of them is the
// Dashboard, never a trail of tabs.
export default function DashboardTabs({ current, style }) {
  const router = useRouter();
  const role = useAdminRole();
  const scroller = useRef(null);
  // Where the current tab sits in the row, and whether the person has
  // moved the row themselves (after that it is left where they put it).
  const currentX = useRef(null);
  const moved = useRef(false);
  const tabs = dashboardTabs(role);
  if (tabs.length < 2) return null;

  // The row starts with the current tab in sight (Creator Studio is the
  // sixth of six). Asked again when the row's width settles, since the
  // first layout can come before the fonts.
  function place() {
    if (moved.current || currentX.current == null || !scroller.current) return;
    scroller.current.scrollTo({ x: Math.max(0, currentX.current - 24), animated: false });
  }

  function open(tab) {
    if (tab.key === current) return;
    const where = hrefToRoute(tab.href);
    if (!where) return;
    if (!where.route) {
      Linking.openURL(where.url).catch(() => {});
      return;
    }
    if (tab.key === 'overview') router.dismissTo(where.route);
    else if (current === 'overview') router.push(where.route);
    else router.replace(where.route);
  }

  return (
    <View style={[t.wrap, style]}>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={t.row}
        onContentSizeChange={place}
        onScrollBeginDrag={() => { moved.current = true; }}
        accessibilityRole="tablist"
        accessibilityLabel="Creator screens"
      >
        {tabs.map((tab) => {
          const on = tab.key === current;
          return (
            <Pressable
              key={tab.key}
              style={({ pressed }) => [t.tab, on && t.tabOn, pressed && !on && t.pressed]}
              onPress={() => open(tab)}
              onLayout={on ? (e) => {
                currentX.current = e.nativeEvent.layout.x;
                place();
              } : undefined}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[t.text, on && t.textOn]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const t = StyleSheet.create({
  wrap: { borderBottomWidth: 1, borderBottomColor: inkTint(0.14) },
  row: { gap: 20, paddingRight: 12 },
  // 44pt tall whatever the text size; the current one carries the accent
  // under it.
  tab: { minHeight: 44, minWidth: 44, justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: colors.brass },
  pressed: { opacity: 0.7 },
  text: { fontFamily: fonts.displaySemi, fontSize: 14.5, color: colors.inkDim },
  textOn: { color: colors.ink }
});
