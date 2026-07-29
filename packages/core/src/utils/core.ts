import type { RequireAtLeastOne, UnknownRecord } from "type-fest";

const PHONE_NUMBER_CODE_LENGTH = 3;
const PHONE_NUMBER_NDC_LENGTH = 3;
const PHONE_NUMBER_UNIQ_NUMBER_LENGTH_1 = 6;
const PHONE_NUMBER_UNIQ_NUMBER_LENGTH_2 = 7;
const PHONE_NUMBER_UNIQ_NUMBER_LENGTH_3 = 8;

/**
 * Clamps a value to a specified range.
 *
 * @example
 * clamp({ value: 12, min: 0, max: 10 }) // 10
 * clamp({ value: -5, min: 0, max: 10 }) // 0
 *
 * @param {object} options - options object
 * @param {number} options.value - value to clamp
 * @param {number} options.min - minimum value
 * @param {number} options.max - maximum value
 * @returns {number} clamped value
 */
export const clamp = ({
  value,
  min,
  max,
}: {
  value: number;
  min: number;
  max: number;
}): number => Math.min(Math.max(value, min), max);

/**
 * Format phone number based on mockup, currently only covered minimum 11 characters and max 15 characters include +62
 * e.g +62-812-7363-6365
 *
 * @param phoneNumber - input should include "+62"
 */
export const indonesianPhoneNumberFormat = (phoneNumber: string) => {
  // e.g: +62
  const code = phoneNumber.slice(0, PHONE_NUMBER_CODE_LENGTH);
  const numbers = phoneNumber.slice(PHONE_NUMBER_CODE_LENGTH);
  // e.g 812, 852
  const ndc = numbers.slice(0, PHONE_NUMBER_NDC_LENGTH);
  // e.g the rest of the numbers
  const uniqNumber = numbers.slice(PHONE_NUMBER_CODE_LENGTH);
  let regexp: RegExp;

  if (uniqNumber.length <= PHONE_NUMBER_UNIQ_NUMBER_LENGTH_1) {
    regexp = /(?<left>\d{3})(?<right>\d+)/u;
  } else if (uniqNumber.length === PHONE_NUMBER_UNIQ_NUMBER_LENGTH_2) {
    regexp = /(?<left>\d{3})(?<right>\d{4})/u;
  } else if (uniqNumber.length === PHONE_NUMBER_UNIQ_NUMBER_LENGTH_3) {
    regexp = /(?<left>\d{4})(?<right>\d{4})/u;
  } else {
    regexp = /(?<left>\d{4})(?<right>\d{5,})/u;
  }

  const matches = uniqNumber.replace(regexp, "$<left>-$<right>");

  return [code, ndc, matches].join("-");
};

/**
 * Whether a value is a plain object, i.e. an object literal or `Object.create(null)`.
 *
 * Class instances (`Date`, `File`, `Map`, `Set`, `RegExp`, …) are not plain.
 * The key converters use this to recurse only into structures whose keys are
 * meaningful; recursing into a `Date` would yield `{}`, silently losing it.
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === null || prototype === Object.prototype;
};

/**
 * convert deep nested object keys to camelCase.
 *
 * Keys whose value is `undefined` are dropped. Values that are not plain
 * objects or arrays — including `Date` and `File` — are passed through as-is.
 */
export const toCamelCase = <T>(object: unknown): T => {
  if (Array.isArray(object)) {
    return object.map((item) => toCamelCase(item)) as T;
  }

  if (!isPlainObject(object)) {
    return object as T;
  }

  const transformedObject: Record<string, unknown> = {};

  for (const key of Object.keys(object)) {
    if (object[key] !== undefined) {
      const firstUnderscore = key.replace(/^_/u, "");
      const newKey = firstUnderscore.replaceAll(
        /(?<sep>[_-])(?<char>\w)/gu,
        (_match, _sep: string, char: string) => char.toUpperCase()
      );
      transformedObject[newKey] = toCamelCase(object[key]);
    }
  }

  return transformedObject as T;
};

/**
 * convert deep nested object keys to snake_case.
 *
 * Keys whose value is `undefined` are dropped. Values that are not plain
 * objects or arrays — including `Date` and `File` — are passed through as-is.
 *
 * Note this is not the exact inverse of {@link toCamelCase}: a run of capitals
 * collapses into a single segment, so `userID` becomes `user_id`, which
 * converts back to `userId`.
 */
export const toSnakeCase = <T>(object: unknown): T => {
  if (Array.isArray(object)) {
    return object.map((item) => toSnakeCase(item)) as T;
  }

  if (!isPlainObject(object)) {
    return object as T;
  }

  const transformedObject: Record<string, unknown> = {};

  for (const key of Object.keys(object)) {
    if (object[key] !== undefined) {
      const newKey = key
        .replaceAll(
          /\.?(?<letters>[A-Z]+)/gu,
          (_match, letters: string) =>
            `_${letters ? letters.toLowerCase() : ""}`
        )
        .replace(/^_/u, "");
      transformedObject[newKey] = toSnakeCase(object[key]);
    }
  }

  return transformedObject as T;
};

/**
 * Remove a single leading zero, or collapse a run of leading zeros to one.
 *
 * @example
 * removeLeadingZeros('0012') // '012' — one zero is removed, not all of them
 * removeLeadingZeros('007')  // '07'
 * removeLeadingZeros('000')  // '0'  — no non-zero digit follows, so the run collapses
 */
export const removeLeadingZeros = (value: string) => {
  if (/^0+[1-9]+/u.test(value)) {
    return value.replace(/^0/u, "");
  }

  return value.replace(/^0{2,}/u, "0");
};

/**
 * Remove leading whitespaces
 *
 * @example
 * removeLeadingWhitespace('   hello') // 'hello'
 * removeLeadingWhitespace('   ')      // ''
 * removeLeadingWhitespace(undefined)  // ''
 */
export const removeLeadingWhitespace = (value?: string) => {
  if (!value) {
    return "";
  }

  return value.replace(/^\s+/u, "");
};

/**
 * Convert deep object to FormData.
 * Supports File, array, and options to add object rootName and ignore object keys.
 *
 * @example
 *
 * const formData = objectToFormData({
 *   num: 1,
 *   falseBool: false,
 *   trueBool: true,
 *   empty: '',
 *   und: undefined,
 *   nullable: null,
 *   date: new Date(),
 *   file: new File(["foo"], "foo.txt", {
 *     type: "text/plain",
 *   }),
 *   name: 'str',
 *   another_object: {
 *     name: 'my_name',
 *     value: 'whatever'
 *   },
 *   array: [
 *     {
 *       nested_key1: {
 *         name: 'key1'
 *       }
 *     }
 *   ]
 * });
 *
 * // results
 * (2) ['num', '1']
 * (2) ['falseBool', 'false']
 * (2) ['trueBool', 'true']
 * (2) ['empty', '']
 * (2) ['file', File]
 * (2) ['name', 'str']
 * (2) ['another_object.name', 'my_name']
 * (2) ['another_object.value', 'whatever']
 * (2) ['array[0].nested_key1.name', 'key1']
 */
export const objectToFormData = <T extends UnknownRecord>(
  obj: T,
  options?: RequireAtLeastOne<{
    rootName?: string;
    ignoreList: (keyof T)[];
  }>
) => {
  const formData = new FormData();

  const ignore = (_key?: string) =>
    Array.isArray(options?.ignoreList) &&
    options?.ignoreList.includes(_key as keyof T);

  const appendFormData = (_obj: T, _rootName_?: string) => {
    let _rootName = _rootName_;

    if (!ignore(_rootName)) {
      _rootName ||= "";

      if (_obj instanceof File) {
        formData.append(_rootName, _obj);
      } else if (Array.isArray(_obj)) {
        for (let i = 0; i < _obj.length; i += 1) {
          appendFormData(_obj[i], `${_rootName}[${i}]`);
        }
      } else if (typeof _obj === "object" && _obj) {
        for (const key in _obj) {
          if (Object.hasOwn(_obj, key)) {
            if (_rootName === "") {
              // @ts-expect-error i'm not typescript wizard
              appendFormData(_obj[key], key);
            } else {
              // @ts-expect-error i'm not typescript wizard
              appendFormData(_obj[key], `${_rootName}.${key}`);
            }
          }
        }
      } else if (_obj !== null && _obj !== undefined) {
        formData.append(_rootName, _obj);
      }
    }
  };

  appendFormData(obj, options?.rootName);

  return formData;
};

/**
 * Convert deep object to FormData.
 * Supports File, array, and options to add object rootName and ignore object keys.
 *
 * @example
 *
 * const formData = objectToFormDataArrayWithComma({
 *   num: 1,
 *   falseBool: false,
 *   trueBool: true,
 *   empty: '',
 *   und: undefined,
 *   nullable: null,
 *   date: new Date(),
 *   file: new File(["foo"], "foo.txt", {
 *     type: "text/plain",
 *   }),
 *   name: 'str',
 *   another_object: {
 *     name: 'my_name',
 *     value: 'whatever'
 *   },
 *   array: [
 *     "value1",
 *     "value2"
 *   ]
 * });
 *
 * // results
 * (2) ['num', '1']
 * (2) ['falseBool', 'false']
 * (2) ['trueBool', 'true']
 * (2) ['empty', '']
 * (2) ['file', File]
 * (2) ['name', 'str']
 * (2) ['another_object.name', 'my_name']
 * (2) ['another_object.value', 'whatever']
 * (2) ['array', 'value1,value2']
 */
export const objectToFormDataArrayWithComma = <T extends UnknownRecord>(
  obj: T,
  options?: RequireAtLeastOne<{
    rootName?: string;
    ignoreList: (keyof T)[];
  }>
) => {
  const formData = new FormData();

  const ignore = (_key?: string) =>
    Array.isArray(options?.ignoreList) &&
    options?.ignoreList.includes(_key as keyof T);

  const appendFormData = (_obj: T, _rootName_?: string) => {
    let _rootName = _rootName_;

    if (!ignore(_rootName)) {
      _rootName ||= "";

      if (_obj instanceof File) {
        formData.append(_rootName, _obj);
      } else if (Array.isArray(_obj)) {
        formData.append(_rootName, _obj.join(","));
      } else if (typeof _obj === "object" && _obj) {
        for (const key in _obj) {
          if (Object.hasOwn(_obj, key)) {
            if (_rootName === "") {
              // @ts-expect-error i'm not typescript wizard
              appendFormData(_obj[key], key);
            } else {
              // @ts-expect-error i'm not typescript wizard
              appendFormData(_obj[key], `${_rootName}.${key}`);
            }
          }
        }
      } else if (_obj !== null && _obj !== undefined) {
        formData.append(_rootName, _obj);
      }
    }
  };

  appendFormData(obj, options?.rootName);

  return formData;
};

/**
 * Safely access deep values in an object via a string path seperated by `.`
 * This util is largely inspired by [dlv](https://github.com/developit/dlv/blob/master/index.js)
 *
 * Unlike dlv, a resolved `null` is treated as absent and yields the default.
 * Other falsy values (`0`, `''`, `false`) are returned as found.
 *
 * @param obj {Record<string, unknown>} - The object to parse
 * @param path {string} - The path to search in the object
 * @param [defaultValue] {unknown} -  A default value if the path doesn't exist in the object
 *
 * @returns {any} The value if found, the default provided value if set and not found, undefined otherwise
 *
 * @example
 *
 * ```js
 * const obj = { a: { b : { c: 'hello' } } };
 *
 * const value = deepReadObject(obj, 'a.b.c');
 * // => 'hello'
 * const notFound = deepReadObject(obj, 'a.b.d');
 * // => undefined
 * const notFound = deepReadObject(obj, 'a.b.d', 'not found');
 * // => 'not found'
 * ```
 */
// oxlint-disable-next-line typescript/no-explicit-any
export const deepReadObject = <T = any>(
  obj: Record<string, unknown>,
  path: string,
  defaultValue?: unknown
): T => {
  const value = path
    .trim()
    .split(".")
    // oxlint-disable-next-line typescript/no-explicit-any
    .reduce<any>((a, b) => (a ? a[b] : undefined), obj);

  return value ?? (defaultValue as T);
};
