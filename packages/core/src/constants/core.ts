export type Theme = 'system' | 'light' | 'dark';

export const themes: Theme[] = ['system', 'light', 'dark'];

// object version of `themes`
export const modes = themes.reduce(
  (acc, item) => {
    acc[item] = item;
    return acc;
  },
  {} as Record<Theme, Theme>
);

export const kilobyteMultiplier = 1024;
export const megabyteMultiplier = kilobyteMultiplier * kilobyteMultiplier;
export const gigabyteMultiplier = megabyteMultiplier * kilobyteMultiplier;

export const indoTimezone = ['WIB', 'WITA', 'WIT'] as const;
