import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { mergeAlertSettings } from '@/alerts/evaluate';
import { getServices } from '@/data/services';
import { runRefreshCycle } from '@/refresh/coordinator';

export const BACKGROUND_TASK = 'usage-background-refresh';

/**
 * Must be defined at module scope so iOS can launch it headlessly. iOS decides when (and whether)
 * to run it: typically a few times a day at best, and less if the app is rarely opened.
 */
TaskManager.defineTask(BACKGROUND_TASK, async () => {
  try {
    const s = await getServices();
    const settings = mergeAlertSettings(await s.repos.settings.getJson('alerts', null));
    if (!settings.backgroundRefresh) return BackgroundTask.BackgroundTaskResult.Success;
    await runRefreshCycle(s.cycleDeps, { budgetMs: 20_000 });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export type BackgroundState = 'active' | 'off' | 'restricted';

/** Align the OS registration with the user's setting. Safe to call repeatedly. */
export async function syncBackgroundRegistration(enabled: boolean): Promise<BackgroundState> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return 'restricted';
    const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK);
    if (enabled) {
      if (!registered)
        await BackgroundTask.registerTaskAsync(BACKGROUND_TASK, { minimumInterval: 60 });
      return 'active';
    }
    if (registered) await BackgroundTask.unregisterTaskAsync(BACKGROUND_TASK);
    return 'off';
  } catch {
    return 'restricted';
  }
}
