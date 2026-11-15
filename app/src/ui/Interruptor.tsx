/* Interruptor propio: el pomo se desliza en una transición corta (sin rebote) y la pista se ilumina. */
import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Pressable } from 'react-native';
import Animated, { Easing, interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { C } from './tema';

export function Interruptor({ on, onChange, fijo, label }: { on: boolean; onChange: (v: boolean) => void; fijo?: boolean; label: string }) {
  const p = useSharedValue(on ? 1 : 0);
  useEffect(() => { p.value = withTiming(on ? 1 : 0, { duration: 160, easing: Easing.out(Easing.cubic) }); }, [on, p]);
  const pista = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(p.value, [0, 1], [C.l2, fijo ? 'rgba(70,200,232,0.45)' : C.sig]) }));
  const pomo = useAnimatedStyle(() => ({ transform: [{ translateX: 3 + p.value * 20 }] }));
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: on, disabled: fijo }}
      disabled={fijo}
      hitSlop={8}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); onChange(!on); }}
    >
      <Animated.View style={[{ width: 51, height: 31, borderRadius: 16, justifyContent: 'center' }, pista]}>
        <Animated.View style={[{ width: 25, height: 25, borderRadius: 13, backgroundColor: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }, pomo]} />
      </Animated.View>
    </Pressable>
  );
}
