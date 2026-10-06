import * as Haptics from 'expo-haptics';

/**
 * The app's haptic vocabulary, kept small so every touch means the same thing everywhere:
 * - `tap`: a button committed an action
 * - `select`: a value changed (option tile, switch)
 * - `refresh`: pull-to-refresh crossed its threshold
 * - `success` / `warning` / `error`: the outcome of a task, or a destructive confirmation
 *
 * Fire-and-forget: the Taptic Engine is silently unavailable in Low Power Mode, while the camera
 * or dictation runs, or when the user turned it off, and none of that should surface as an error.
 */
function run(effect: () => Promise<void>) {
  effect().catch(() => {});
}

export const haptics = {
  tap: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  select: () => run(() => Haptics.selectionAsync()),
  refresh: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
