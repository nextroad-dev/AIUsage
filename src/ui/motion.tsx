import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

/**
 * One motion vocabulary for the whole app: short, calm, decelerating. Every animation below runs
 * through Reanimated, whose default `ReduceMotion.System` makes it jump straight to the end state
 * when the OS asks for reduced motion, so feedback stays readable without movement.
 */
export const Motion = {
  fast: 140,
  base: 220,
  slow: 420,
  /** per-item delay for staggered list entrances, capped so long lists don't drag */
  stagger: 45,
  maxStagger: 6,
  easing: Easing.out(Easing.cubic),
  spring: { damping: 18, stiffness: 320, mass: 0.6 },
} as const;

/** Content appearing in place (a status line, an error, a revealed option). */
export const enterFade = FadeIn.duration(Motion.base).easing(Motion.easing);
export const exitFade = FadeOut.duration(Motion.fast);

/** List items rising into place, staggered by position. */
export function enterItem(index = 0) {
  return FadeInDown.duration(Motion.base + 60)
    .easing(Motion.easing)
    .withInitialValues({ transform: [{ translateY: 10 }] })
    .delay(Math.min(index, Motion.maxStagger) * Motion.stagger);
}

/** Siblings sliding to their new place when something above them appears or disappears. */
export const layoutShift = LinearTransition.duration(Motion.base).easing(Motion.easing);

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Pressable with tactile feedback: a slight spring scale plus dimming while held. Under reduced
 * motion only the dimming remains. `style` must be static (no `({ pressed })` callback).
 */
export function PressableScale({
  children,
  style,
  scaleTo = 0.97,
  disabled,
  onPressIn,
  onPressOut,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** scale while held; lists use a gentler value than buttons */
  scaleTo?: number;
}) {
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);
  const animated = useAnimatedStyle(() => ({
    opacity: 1 - pressed.value * 0.18,
    transform: [{ scale: reduced ? 1 : 1 - pressed.value * (1 - scaleTo) }],
  }));

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        pressed.value = withTiming(1, { duration: 90 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.value = withSpring(0, Motion.spring);
        onPressOut?.(e);
      }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}
