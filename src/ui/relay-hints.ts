import type { Translator } from '@/i18n';
import type { RelayType } from '@/providers/relay/inspect';

/**
 * A relay key without a quota ceiling only reports what it has spent: there is no remaining
 * amount, no usage share and nothing to alert on. Tell the user where to set the ceiling.
 */
export function unlimitedKeyHint(type: RelayType, t: Translator): string {
  return type === 'new-api'
    ? t(
        'This key has no quota limit, so only spending can be shown: no remaining amount and no alerts. Set a quota for this key on the Tokens page of the relay site, then detect again.',
      )
    : t(
        'This key has no quota limit, so only spending can be shown: no remaining amount and no alerts. Set a quota limit for this key in the relay site, then detect again.',
      );
}
