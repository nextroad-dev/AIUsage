import { useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

import { Spacing } from '@/constants/theme';

/**
 * Option rows are laid out as an equal-width grid instead of pills that size to their text, so a
 * group looks the same whatever the language is ("跟随系统" / "Follow system") and every button in
 * a group has the same width. Columns are chosen from the option count and label length, and the
 * item width follows the measured container so the grid fills the available width exactly.
 */
export function defaultColumns(labels: string[]): number {
  const count = labels.length;
  if (count <= 3) return Math.max(1, count);
  const longest = labels.reduce((max, label) => Math.max(max, label.length), 0);
  if (count === 4) return longest <= 4 ? 4 : 2;
  return 3;
}

export interface OptionGrid {
  columns: number;
  gap: number;
  /** undefined until the container has been measured */
  itemWidth?: number;
  onLayout: (event: LayoutChangeEvent) => void;
  itemStyle: {
    width?: number;
    flexGrow: number;
    flexBasis?: `${number}%`;
  };
}

export function useOptionGrid(labels: string[], columns?: number): OptionGrid {
  const [width, setWidth] = useState(0);
  const count = Math.max(1, labels.length);
  const cols = columns ?? defaultColumns(labels);
  const gap = Spacing.two;
  const itemWidth = width > 0 ? Math.floor((width - gap * (cols - 1)) / cols) : undefined;

  return {
    columns: cols,
    gap,
    itemWidth,
    onLayout: (event) => setWidth(event.nativeEvent.layout.width),
    itemStyle: itemWidth
      ? { width: itemWidth, flexGrow: 0 }
      : { flexGrow: 1, flexBasis: `${100 / count}%` },
  };
}
