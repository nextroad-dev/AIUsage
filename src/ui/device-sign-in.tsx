import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Band } from '@/components/section';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { DeviceFlowError } from '@/authkit/device-flow';
import type { Credential } from '@/core/types';
import { useT, type Translator } from '@/i18n';
import {
  beginDeviceSignIn,
  NotConfiguredError,
  type DeviceSignIn,
} from '@/providers/device-signin';
import { Button } from '@/ui/controls';
import { haptics } from '@/ui/haptics';
import { enterFade, exitFade, layoutShift } from '@/ui/motion';

type State =
  | { step: 'idle' }
  | { step: 'starting' }
  | { step: 'waiting'; info: DeviceSignIn }
  | { step: 'error'; message: string };

function messageFor(e: unknown, t: Translator): string {
  if (e instanceof NotConfiguredError) return t(e.message);
  if (e instanceof DeviceFlowError) {
    if (e.code === 'expired') return t('The code expired. Start again.');
    if (e.code === 'denied') return t('Sign-in was declined.');
    if (e.code === 'cancelled') return t('Sign-in was cancelled.');
    return t(e.message);
  }
  return t('Could not reach the service.');
}

/** Shows the user code, waits for approval, hands back a credential. Cancels cleanly on unmount. */
export function DeviceSignInPanel({
  flow,
  onCredential,
  busy,
}: {
  flow: 'codexDevice' | 'githubDevice';
  onCredential: (cred: Credential) => void;
  busy?: boolean;
}) {
  const t = useT();
  const theme = useTheme();
  const [state, setState] = useState<State>({ step: 'idle' });
  const abort = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => abort.current?.abort(), []);

  const start = async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setState({ step: 'starting' });
    try {
      const info = await beginDeviceSignIn(flow);
      if (ctrl.signal.aborted) return;
      setState({ step: 'waiting', info });
      const cred = await info.wait(ctrl.signal);
      if (ctrl.signal.aborted) return;
      // The code is used up: leave the waiting view (the parent shows the check's outcome, and the
      // button then reads busy while the account is checked and saved).
      setState({ step: 'idle' });
      onCredential(cred);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      if (!(e instanceof DeviceFlowError && e.code === 'cancelled')) haptics.error();
      setState({ step: 'error', message: messageFor(e, t) });
    }
  };

  const cancel = () => {
    abort.current?.abort();
    setState({ step: 'idle' });
  };

  return (
    <View style={{ gap: Spacing.three }}>
      {state.step === 'waiting' ? (
        <Band key="waiting" entering={enterFade} exiting={exitFade} layout={layoutShift}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('Open the page below and enter this code:')}
          </ThemedText>
          <ThemedText type="subtitle" selectable accessibilityLabel={t('Sign-in code')}>
            {state.info.userCode}
          </ThemedText>
          <Button
            title={t('Open sign-in page')}
            onPress={() => Linking.openURL(state.info.verificationUri)}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {t('Waiting for approval…')}
          </ThemedText>
          <Button title={t('Cancel')} kind="secondary" onPress={cancel} />
        </Band>
      ) : (
        <Animated.View key="start" entering={enterFade} layout={layoutShift}>
          <Button
            title={t('Sign in')}
            onPress={start}
            loading={state.step === 'starting' || busy}
          />
        </Animated.View>
      )}
      {state.step === 'error' && (
        <Animated.View entering={enterFade} exiting={exitFade}>
          <ThemedText type="small" style={{ color: theme.bad }}>
            {state.message}
          </ThemedText>
        </Animated.View>
      )}
    </View>
  );
}
