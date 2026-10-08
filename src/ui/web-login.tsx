import { useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { Band } from '@/components/section';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { cookieModuleAvailable, webKitCookies } from '@/authkit/expo-cookies';
import {
  credentialFromCookieHeader,
  parseCookieHeader,
  tryCapture,
  type CookieSource,
} from '@/authkit/web-session';
import { isAllowedNavigation, type CaptureSpec } from '@/authkit/webview-capture';
import type { Credential } from '@/core/types';
import { useT } from '@/i18n';
import { Button, Field } from '@/ui/controls';

const READ_COOKIE_JS = 'window.ReactNativeWebView.postMessage(document.cookie); true;';

/**
 * Sign in on the provider's own website inside the app, then read the session cookies from the
 * WebKit cookie store. The app never sees the password. If the provider refuses embedded sign-in
 * (Google/Apple SSO), the user can paste the cookie copied from a desktop browser instead.
 */
export function WebLoginPanel({
  spec,
  onCredential,
  busy,
}: {
  spec: CaptureSpec;
  onCredential: (cred: Credential) => void;
  busy?: boolean;
}) {
  const t = useT();
  const [hint, setHint] = useState<string>();
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const docCookie = useRef('');
  const delivered = useRef(false);

  const source: CookieSource = cookieModuleAvailable()
    ? webKitCookies
    : // Expo Go has no cookie module: fall back to what page scripts can see (no HttpOnly cookies).
      { get: async () => parseCookieHeader(docCookie.current) };

  const attempt = async (explicit: boolean) => {
    if (delivered.current || busy) return;
    const cred = await tryCapture(spec, source);
    if (cred) {
      delivered.current = true;
      onCredential(cred);
    } else if (explicit) {
      setHint(t('No signed-in session found yet. Finish signing in on the page, then try again.'));
    }
  };

  const submitPasted = () => {
    const cred = credentialFromCookieHeader(spec, pasted);
    if (cred) onCredential(cred);
    else setHint(t('That text does not contain the expected session cookie.'));
  };

  return (
    <View style={{ gap: Spacing.three }}>
      {!pasting && (
        <Band style={{ padding: 0, overflow: 'hidden' }}>
          <View style={{ height: 420 }}>
            <WebView
              source={{ uri: spec.loginUrl }}
              sharedCookiesEnabled
              // subframes (captcha, identity widgets) load freely; the page itself stays on-domain
              onShouldStartLoadWithRequest={(req) =>
                req.isTopFrame === false || isAllowedNavigation(spec, req.url)
              }
              injectedJavaScript={READ_COOKIE_JS}
              onMessage={(e: WebViewMessageEvent) => {
                docCookie.current = e.nativeEvent.data;
              }}
              onLoadEnd={() => void attempt(false)}
              accessibilityLabel={t('Provider sign-in page')}
            />
          </View>
        </Band>
      )}

      {!cookieModuleAvailable() && !pasting && (
        <ThemedText type="small" themeColor="textSecondary">
          {t(
            'This preview build cannot read protected cookies. If sign-in is not detected, paste the cookie instead.',
          )}
        </ThemedText>
      )}

      {pasting ? (
        <View style={{ gap: Spacing.three }}>
          <Field
            label={t('Cookie')}
            value={pasted}
            onChangeText={setPasted}
            multiline
            secureTextEntry={false}
            placeholder="name=value; name2=value2"
            hint={t(
              'Copy the Cookie header (or the session cookie value) from your desktop browser’s developer tools while signed in.',
            )}
          />
          <Button
            title={t('Check and add')}
            onPress={submitPasted}
            loading={busy}
            disabled={!pasted.trim()}
          />
          <Button
            title={t('Back to sign-in page')}
            kind="secondary"
            onPress={() => setPasting(false)}
          />
        </View>
      ) : (
        <View style={{ gap: Spacing.two }}>
          <Button title={t('I’ve signed in')} onPress={() => void attempt(true)} loading={busy} />
          <Button
            title={t('Paste a cookie instead')}
            kind="secondary"
            onPress={() => setPasting(true)}
          />
        </View>
      )}

      {hint && (
        <ThemedText type="small" style={{ color: '#C62828' }}>
          {hint}
        </ThemedText>
      )}
    </View>
  );
}
