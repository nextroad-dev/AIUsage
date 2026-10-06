import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react-native';
import { act } from 'react';

import { ThemedText } from '@/components/themed-text';
import { createTranslator, setLocale, useT } from '@/i18n';

/**
 * Regression tests for the "language switch does not apply immediately" bug.
 *
 * Root cause: with `experiments.reactCompiler` enabled, the compiler caches calls to imported
 * functions whose arguments are constants into a dependency-free slot, including the
 * module-level translation helper — so rendered text froze on the first language it was shown
 * with, even though the component re-rendered (the call itself was never re-executed; verified
 * against the compiled output). Components must therefore translate through `useT()`, whose
 * identity changes with the locale and thus becomes a real dependency of every call using it.
 */
describe('translator reactivity under the React Compiler', () => {
  afterEach(async () => {
    await act(async () => setLocale('en'));
  });

  it('gives the translator a new identity whenever the language changes', () => {
    // This identity change is the whole mechanism: it is what the compiler observes.
    const en = createTranslator('en');
    const zh = createTranslator('zh');
    expect(en).not.toBe(zh);
    expect(en('Settings')).toBe('Settings');
    expect(zh('Settings')).toBe('设置');
  });

  it('re-renders a component using useT() with the new language', async () => {
    function Panel() {
      const t = useT();
      return <ThemedText>{t('Settings')}</ThemedText>;
    }

    await render(<Panel />);
    expect(screen.getByText('Settings')).toBeTruthy();

    await act(async () => {
      setLocale('zh');
    });
    expect(screen.getByText('设置')).toBeTruthy();

    await act(async () => {
      setLocale('en');
    });
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('keeps translated props reactive, not just text children', async () => {
    function Panel() {
      const t = useT();
      return <ThemedText accessibilityLabel={t('Weekly')} />;
    }

    await render(<Panel />);
    expect(screen.getByLabelText('Weekly')).toBeTruthy();
    await act(async () => {
      setLocale('zh');
    });
    expect(screen.getByLabelText('每周')).toBeTruthy();
  });
});

describe('i18n source guard', () => {
  /** Components must not import the module-level t(); the compiler would freeze their text. */
  it('no component file imports the global t()', () => {
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(path);
        } else if (/\.tsx$/.test(entry.name)) {
          const source = readFileSync(path, 'utf8');
          for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@\/i18n'/g)) {
            const names = match[1].split(',').map(
              (part) =>
                part
                  .trim()
                  .replace(/^type\s+/, '')
                  .split(/\s+as\s+/)[0],
            );
            if (names.includes('t')) offenders.push(path);
          }
        }
      }
    };
    walk(join(__dirname, '..', '..'));

    expect(offenders).toEqual([]);
  });
});
