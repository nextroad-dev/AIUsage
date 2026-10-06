import { compareVersions, fetchLatestRelease, pickNotice, RELEASES_API } from '@/data/update-check';
import { fakeFetch } from '@/test-utils/fetch';

describe('update check', () => {
  it('compares dotted versions numerically, with or without a leading v', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1);
    expect(compareVersions('v1.2.0', '1.10.0')).toBe(-1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('nightly', '1.0.0')).toBe(0);
  });

  it('reads the latest published release and skips drafts and pre-releases', async () => {
    const ok = fakeFetch({
      [RELEASES_API]: {
        json: { tag_name: 'v1.0.3', html_url: 'https://github.com/x/releases/tag/v1.0.3' },
      },
    });
    expect(await fetchLatestRelease(ok.fetch)).toEqual({
      version: '1.0.3',
      url: 'https://github.com/x/releases/tag/v1.0.3',
    });
    const pre = fakeFetch({
      [RELEASES_API]: { json: { tag_name: 'v2.0.0', html_url: 'u', prerelease: true } },
    });
    expect(await fetchLatestRelease(pre.fetch)).toBeUndefined();
    expect(await fetchLatestRelease(fakeFetch({}).fetch)).toBeUndefined();
  });

  it('offers only a newer, not yet dismissed version', () => {
    const latest = { version: '1.0.3', url: 'u' };
    expect(pickNotice(latest, '1.0.2', null)).toBe(latest);
    expect(pickNotice(latest, '1.0.3', null)).toBeUndefined();
    // dismissing 1.0.3 silences it, but 1.0.4 is offered again
    expect(pickNotice(latest, '1.0.2', '1.0.3')).toBeUndefined();
    expect(pickNotice({ version: '1.0.4', url: 'u' }, '1.0.2', '1.0.3')).toBeTruthy();
    expect(pickNotice(undefined, '1.0.2', null)).toBeUndefined();
  });
});
