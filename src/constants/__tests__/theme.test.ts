import { Accents, Colors, DEFAULT_ACCENT, isAccentName } from '@/constants/theme';

/** WCAG relative luminance of a #RRGGBB colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('theme tokens', () => {
  it('defines the same keys for light and dark', () => {
    expect(Object.keys(Colors.dark).sort()).toEqual(Object.keys(Colors.light).sort());
  });

  it('keeps white button text readable on every theme colour', () => {
    for (const [name, color] of Object.entries(Accents)) {
      expect([name, contrast(color, '#FFFFFF') >= 4.5]).toEqual([name, true]);
    }
  });

  it('defaults to the original blue and validates stored names', () => {
    expect(Accents[DEFAULT_ACCENT]).toBe(Colors.light.primary);
    expect(isAccentName('teal')).toBe(true);
    expect(isAccentName('neon')).toBe(false);
    expect(isAccentName('toString')).toBe(false);
  });
});
