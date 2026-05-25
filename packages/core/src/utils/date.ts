const validIANATimezoneCache: Record<string, boolean> = {};

/**
 * check if the provided timezone is supported or not
 */
export const isValidTimezoneIANAString = (timeZoneString: string) => {
  if (validIANATimezoneCache[timeZoneString]) {
    return true;
  }

  try {
    Intl.DateTimeFormat(undefined, { timeZone: timeZoneString });
    validIANATimezoneCache[timeZoneString] = true;
    return true;
  } catch {
    // eslint-disable-next-line unused-imports/no-unused-vars
    return false;
  }
};

/**
 * The `getLocalTimeZone` from `@internationalized/date` will throw error in Chrome 118
 */
export const getLocalTimeZone = () =>
  Intl.DateTimeFormat("id-ID", {
    timeZone: "GMT", // Asia/Jakarta
  }).resolvedOptions().timeZone;
