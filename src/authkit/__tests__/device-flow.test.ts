import {
  DeviceFlowError,
  pollDeviceFlow,
  startDeviceFlow,
  type DeviceFlowConfig,
  type FlowDeps,
} from '@/authkit/device-flow';

const cfg: DeviceFlowConfig = {
  deviceCodeUrl: 'https://idp.test/device/code',
  tokenUrl: 'https://idp.test/token',
  clientId: 'cid',
  scope: 'read:user',
};

function harness(tokenReplies: Record<string, unknown>[], startReply?: Record<string, unknown>) {
  let t = 1_000_000;
  const sleeps: number[] = [];
  const bodies: string[] = [];
  const replies = [...tokenReplies];
  const deps: FlowDeps = {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === cfg.deviceCodeUrl) {
        bodies.push(String(init?.body));
        return new Response(
          JSON.stringify(
            startReply ?? {
              device_code: 'dev',
              user_code: 'ABCD-1234',
              verification_uri: 'https://idp.test/activate',
              interval: 5,
              expires_in: 900,
            },
          ),
        );
      }
      bodies.push(String(init?.body));
      const next = replies.shift() ?? { error: 'authorization_pending' };
      return new Response(JSON.stringify(next), { status: next.access_token ? 200 : 400 });
    }) as typeof fetch,
  };
  return { deps, sleeps, bodies };
}

describe('startDeviceFlow', () => {
  it('returns the user code and verification URL', async () => {
    const h = harness([]);
    const s = await startDeviceFlow(cfg, h.deps);
    expect(s).toMatchObject({
      userCode: 'ABCD-1234',
      verificationUri: 'https://idp.test/activate',
      interval: 5,
    });
    expect(s.expiresAt).toBe(1_000_000 + 900_000);
    expect(h.bodies[0]).toBe('client_id=cid&scope=read%3Auser');
  });

  it('fails on an unusable response', async () => {
    const h = harness([], { error: 'bad_client' });
    await expect(startDeviceFlow(cfg, h.deps)).rejects.toMatchObject({ code: 'failed' });
  });
});

describe('pollDeviceFlow', () => {
  const start = {
    deviceCode: 'dev',
    userCode: 'U',
    verificationUri: 'u',
    interval: 5,
    expiresAt: 1_000_000 + 900_000,
  };

  it('waits through authorization_pending and returns tokens', async () => {
    const h = harness([
      { error: 'authorization_pending' },
      { error: 'authorization_pending' },
      { access_token: 'at', refresh_token: 'rt', expires_in: 3600 },
    ]);
    const tok = await pollDeviceFlow(cfg, start, { deps: h.deps });
    expect(tok).toMatchObject({ accessToken: 'at', refreshToken: 'rt' });
    expect(tok.expiresAt).toBe(1_000_000 + 15_000 + 3_600_000);
    expect(h.sleeps).toEqual([5000, 5000, 5000]);
    expect(h.bodies[0]).toContain(
      'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code',
    );
    expect(h.bodies[0]).toContain('device_code=dev');
  });

  it('slows down by 5 s on slow_down, cumulatively', async () => {
    const h = harness([{ error: 'slow_down' }, { error: 'slow_down' }, { access_token: 'at' }]);
    await pollDeviceFlow(cfg, start, { deps: h.deps });
    expect(h.sleeps).toEqual([5000, 10_000, 15_000]);
  });

  it('maps expired_token, access_denied and unknown errors', async () => {
    await expect(
      pollDeviceFlow(cfg, start, { deps: harness([{ error: 'expired_token' }]).deps }),
    ).rejects.toMatchObject({ code: 'expired' });
    await expect(
      pollDeviceFlow(cfg, start, { deps: harness([{ error: 'access_denied' }]).deps }),
    ).rejects.toMatchObject({ code: 'denied' });
    await expect(
      pollDeviceFlow(cfg, start, { deps: harness([{ error: 'weird' }]).deps }),
    ).rejects.toMatchObject({ code: 'failed', message: 'weird' });
  });

  it('gives up locally once the code has expired', async () => {
    const h = harness([]); // pending forever
    const short = { ...start, expiresAt: 1_000_000 + 12_000 };
    await expect(pollDeviceFlow(cfg, short, { deps: h.deps })).rejects.toMatchObject({
      code: 'expired',
    });
  });

  it('can be cancelled', async () => {
    const h = harness([]);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      pollDeviceFlow(cfg, start, { deps: h.deps, signal: ctrl.signal }),
    ).rejects.toBeInstanceOf(DeviceFlowError);
    expect(h.sleeps).toEqual([]);
  });
});
