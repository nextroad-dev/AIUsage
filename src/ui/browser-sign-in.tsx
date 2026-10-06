import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { BrowserAuthError, type BrowserAuthorization } from '@/authkit/browser-authorize';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { Credential } from '@/core/types';
import { useTheme } from '@/hooks/use-theme';
import { useT, type Translator } from '@/i18n';
import { startCodexBrowserSignIn } from '@/providers/codex/browser';
import { startOpenRouterSignIn } from '@/providers/openrouter/auth';
import { Button } from '@/ui/controls';
import { haptics } from '@/ui/haptics';
import { enterFade, exitFade, layoutShift } from '@/ui/motion';

export type BrowserSignInProvider = 'codex' | 'openrouter';

type Phase = 'idle' | 'starting' | 'waiting' | 'connecting';

function messageFor(error: unknown, t: Translator): string {
  if (error instanceof BrowserAuthError) {
    if (error.code === 'unavailable')
      return t('Browser sign-in is not in this build. Install the current development build.');
    if (error.code === 'port-unavailable')
      return t('Could not start the local sign-in listener. Close other apps and try again.');
    if (error.code === 'cancelled') return t('Sign-in was cancelled.');
    if (error.code === 'expired') return t('The sign-in session expired. Start again.');
    return t('The authorization was rejected or expired. Start again.');
  }
  return t('Could not complete authorization. Start again.');
}

/**
 * Sign-in that leaves the app for the system browser and returns through the loopback callback:
 * the user never types or copies a code. The verifier lives in the session object only, so mode
 * changes, retries and unmount cancel both the browser session and the local listener.
 */
export function BrowserSignInPanel({
  provider,
  onCredential,
  busy,
}: {
  provider: BrowserSignInProvider;
  onCredential: (cred: Credential) => void | Promise<void>;
  busy?: boolean;
}) {
  const theme = useTheme();
  const t = useT();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string>();
  const session = useRef<BrowserAuthorization | undefined>(undefined);
  const generation = useRef(0);
  const pending = useRef(false);

  const invalidate = () => {
    generation.current++;
    pending.current = false;
    session.current?.cancel();
    session.current = undefined;
  };
  useEffect(
    () => () => {
      generation.current++;
      session.current?.cancel();
      session.current = undefined;
    },
    [],
  );

  const cancel = () => {
    if (busy || phase === 'connecting') return;
    invalidate();
    setError(undefined);
    setPhase('idle');
  };

  const start = async () => {
    if (pending.current || busy) return;
    invalidate();
    const id = generation.current;
    pending.current = true;
    setError(undefined);
    setPhase('starting');
    try {
      const info =
        provider === 'codex' ? await startCodexBrowserSignIn() : await startOpenRouterSignIn();
      if (id !== generation.current) {
        info.cancel();
        return;
      }
      session.current = info;
      pending.current = false;
      setPhase('waiting');
      const cred = await info.authorize();
      if (id !== generation.current) return;
      session.current = undefined;
      setPhase('connecting');
      await onCredential(cred);
      if (id !== generation.current) return;
      pending.current = false;
      setPhase('idle');
    } catch (e) {
      if (id !== generation.current) return;
      invalidate();
      setPhase('idle');
      if (!(e instanceof BrowserAuthError && e.code === 'cancelled')) haptics.error();
      setError(messageFor(e, t));
    }
  };

  return (
    <View style={{ gap: Spacing.three }}>
      <ThemedText type="small" themeColor="textSecondary">
        {provider === 'codex'
          ? t('Sign in to ChatGPT in the browser; you come back here automatically.')
          : t(
              'Authorize in the browser and you come back here automatically. OpenRouter creates an API key stored in this device’s Keychain.',
            )}
      </ThemedText>
      <Button
        title={t('Sign in with browser')}
        onPress={start}
        loading={phase === 'starting' || phase === 'connecting' || busy}
      />
      {phase === 'waiting' && (
        <Animated.View
          entering={enterFade}
          exiting={exitFade}
          layout={layoutShift}
          style={{ gap: Spacing.three }}
        >
          <ThemedText type="small" themeColor="textSecondary">
            {t('Waiting for the browser…')}
          </ThemedText>
          <Button title={t('Cancel')} kind="secondary" onPress={cancel} disabled={busy} />
        </Animated.View>
      )}
      {error && (
        <Animated.View entering={enterFade} exiting={exitFade}>
          <ThemedText type="small" style={{ color: theme.bad }}>
            {error}
          </ThemedText>
        </Animated.View>
      )}
    </View>
  );
}
