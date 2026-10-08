import {
  LoopbackPortError,
  LoopbackUnavailableError,
  isLoopbackAvailable,
  startLoopback,
  stopLoopback,
} from '@/authkit/loopback';

const mockStart = jest.fn();
const mockStop = jest.fn();
// Read by the mock factory on every call, so a test can simulate a build without the module.
let mockNativeModule: { start: jest.Mock; stop: jest.Mock } | null = {
  start: mockStart,
  stop: mockStop,
};

jest.mock('../../../modules/usage-oauth-loopback', () => ({
  loopbackNativeModule: () => mockNativeModule,
}));

const STATE = 'q1w2e3r4t5y6u7i8o9p0-_';

beforeEach(() => {
  mockNativeModule = { start: mockStart, stop: mockStop };
  mockStart.mockReset();
  mockStop.mockReset();
});

describe('loopback native wrapper', () => {
  it('returns the bound port reported by the native listener', async () => {
    mockStart.mockResolvedValue({ port: 1457 });
    await expect(startLoopback('codex', 1457, STATE)).resolves.toEqual({ port: 1457 });
    expect(mockStart).toHaveBeenCalledWith('codex', 1457, STATE);
    expect(isLoopbackAvailable()).toBe(true);
  });

  it('maps a refused port and a malformed native answer to port errors', async () => {
    mockStart.mockResolvedValue({ error: 'port-unavailable' });
    await expect(startLoopback('openrouter', 51789, STATE)).rejects.toBeInstanceOf(
      LoopbackPortError,
    );
    mockStart.mockResolvedValue({});
    await expect(startLoopback('openrouter', 51789, STATE)).rejects.toBeInstanceOf(
      LoopbackPortError,
    );
    mockStart.mockResolvedValue({ port: 0 });
    await expect(startLoopback('openrouter', 51789, STATE)).rejects.toBeInstanceOf(
      LoopbackPortError,
    );
  });

  it('stops idempotently and never throws', async () => {
    mockStop.mockRejectedValue(new Error('already stopped'));
    await expect(stopLoopback()).resolves.toBeUndefined();
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('reports a build without the native module instead of falling back silently', async () => {
    mockNativeModule = null;
    expect(isLoopbackAvailable()).toBe(false);
    await expect(startLoopback('codex', 1455, STATE)).rejects.toBeInstanceOf(
      LoopbackUnavailableError,
    );
    await expect(stopLoopback()).resolves.toBeUndefined();
    expect(mockStart).not.toHaveBeenCalled();
  });
});
