import { Colors } from '@/constants/theme';

describe('theme tokens', () => {
  it('defines the same keys for light and dark', () => {
    expect(Object.keys(Colors.dark).sort()).toEqual(Object.keys(Colors.light).sort());
  });
});
