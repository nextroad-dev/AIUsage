import { pollDeviceFlow, realDeps, startDeviceFlow, type FlowDeps } from '@/authkit/device-flow';
import type { Credential } from '@/core/types';
import { completeCodexDevice, startCodexDevice } from '@/providers/codex/auth';
import { GITHUB_CLIENT_ID, githubDeviceConfig } from '@/providers/copilot';

export interface DeviceSignIn {
  /** code the user types on the verification page */
  userCode: string;
  verificationUri: string;
  /** resolves with a credential once the user approves; rejects with DeviceFlowError otherwise */
  wait(signal?: AbortSignal): Promise<Credential>;
}

export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotConfiguredError';
  }
}

/** Start a device sign-in for a provider flow. Nothing is stored; the caller saves the credential. */
export async function beginDeviceSignIn(
  flow: 'codexDevice' | 'githubDevice',
  deps: FlowDeps = realDeps,
  config: { githubClientId?: string } = {},
): Promise<DeviceSignIn> {
  if (flow === 'codexDevice') {
    const start = await startCodexDevice(deps);
    return {
      userCode: start.userCode,
      verificationUri: start.verificationUri,
      wait: (signal) => completeCodexDevice(start, { signal, deps }),
    };
  }
  const clientId = config.githubClientId ?? GITHUB_CLIENT_ID;
  if (!clientId) {
    throw new NotConfiguredError(
      'GitHub sign-in is not configured in this build. Paste a personal access token instead.',
    );
  }
  const cfg = githubDeviceConfig(clientId);
  const start = await startDeviceFlow(cfg, deps);
  return {
    userCode: start.userCode,
    verificationUri: start.verificationUriComplete ?? start.verificationUri,
    wait: async (signal) => {
      const t = await pollDeviceFlow(cfg, start, { signal, deps });
      return {
        type: 'oauth',
        accessToken: t.accessToken,
        refreshToken: t.refreshToken,
        expiresAt: t.expiresAt,
      };
    },
  };
}
