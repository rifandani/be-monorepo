import { get, isPlainObject, set } from "radashi";
import type { RequireAtLeastOne, UnknownRecord } from "type-fest";

const PHONE_NUMBER_CODE_LENGTH = 3;
const PHONE_NUMBER_NDC_LENGTH = 3;
const PHONE_NUMBER_UNIQ_NUMBER_LENGTH_1 = 6;
const PHONE_NUMBER_UNIQ_NUMBER_LENGTH_2 = 7;
const PHONE_NUMBER_UNIQ_NUMBER_LENGTH_3 = 8;

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

type FormDataOptions<T> = RequireAtLeastOne<{
  rootName?: string;
  ignoreList: (keyof T)[];
}>;

/**
 * Appends a nested value under `rootName`, recursing through `append`.
 */
type AppendValue = (value: unknown, rootName?: string) => void;

/**
 * Encodes an array reached at `rootName`. The `objectToFormData*` variants
 * differ only here, so this is the one piece they each supply.
 */
type AppendArray = (
  items: unknown[],
  rootName: string,
  context: { append: AppendValue; formData: FormData }
) => void;

/**
 * Recurses into each own enumerable key of `value`, keyed under the parent's
 * path.
 *
 * `Object.entries` covers the same keys as `for…in` guarded by `Object.hasOwn` —
 * own enumerable string keys, in the same order.
 */
const appendRecord = (value: object, rootName: string, append: AppendValue) => {
  for (const [key, nested] of Object.entries(value)) {
    append(nested, rootName === "" ? key : `${rootName}.${key}`);
  }
};

/**
 * Shared recursion behind the `objectToFormData*` helpers.
 */
const buildFormData = <T extends UnknownRecord>(
  obj: T,
  options: FormDataOptions<T> | undefined,
  appendArray: AppendArray
) => {
  const formData = new FormData();

  const isIgnored = (key?: string) =>
    Array.isArray(options?.ignoreList) &&
    options.ignoreList.includes(key as keyof T);

  // `unknown` rather than `T`: recursion descends into nested values, which are
  // not themselves records. Typing the parameter as the outer generic was what
  // forced the casts this function used to carry.
  const append: AppendValue = (value, key) => {
    if (isIgnored(key)) {
      return;
    }

    // FormData has no representation for either, so both are dropped.
    if (value === null || value === undefined) {
      return;
    }

    const rootName = key ?? "";

    if (value instanceof File) {
      formData.append(rootName, value);
    } else if (Array.isArray(value)) {
      appendArray(value, rootName, { append, formData });
    } else if (typeof value === "object") {
      appendRecord(value, rootName, append);
    } else {
      // FormData stringifies non-Blob values itself; doing it here is the
      // same conversion, just visible to the type checker.
      formData.append(rootName, String(value));
    }
  };

  append(obj, options?.rootName);

  return formData;
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
  options?: FormDataOptions<T>
) =>
  buildFormData(obj, options, (items, rootName, { append }) => {
    // Each item keeps its index, so nested objects stay addressable.
    for (const [index, item] of items.entries()) {
      append(item, `${rootName}[${index}]`);
    }
  });

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
  options?: FormDataOptions<T>
) =>
  buildFormData(obj, options, (items, rootName, { formData }) => {
    formData.append(rootName, items.join(","));
  });

/**
 * Safely access deep values in an object via a string path seperated by `.`,
 * with `[…]` accepted for array indices.
 *
 * A resolved `null` is treated as absent and yields the default; other falsy
 * values (`0`, `''`, `false`) are returned as found.
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
 * const indexed = deepReadObject({ list: [{ id: 1 }] }, 'list[0].id');
 * // => 1
 * ```
 */
// oxlint-disable-next-line typescript/no-explicit-any
export const deepReadObject = <T = any>(
  obj: Record<string, unknown>,
  path: string,
  defaultValue?: unknown
): T => get<T>(obj, path.trim()) ?? (defaultValue as T);

/**
 * The counterpart to {@link deepReadObject}: write a deep value via a string
 * path without mutating the input. Missing levels are created along the way —
 * a numeric segment creates an array, anything else creates an object.
 *
 * Writing `undefined` is a no-op, so this cannot be used to blank a value out;
 * that keeps a missing argument from quietly wiping part of the object.
 *
 * `__proto__`, `prototype` and `constructor` segments throw rather than being
 * written, so a path taken from user input cannot pollute a prototype.
 *
 * @param obj {object} - The object to write into; left untouched
 * @param path {string} - The path to write, e.g. `a.b.c` or `list[0].id`
 * @param value {unknown} - The value to write
 *
 * @returns A copy of `obj` with `path` set to `value`
 *
 * @example
 *
 * ```js
 * deepWriteObject({}, 'a.b.c', 'hello');
 * // => { a: { b: { c: 'hello' } } }
 * deepWriteObject({}, 'cards[0].value', 2);
 * // => { cards: [{ value: 2 }] }
 * deepWriteObject({ a: 1 }, 'a', undefined);
 * // => { a: 1 } — unchanged
 * ```
 */
export const deepWriteObject = <T extends object>(
  obj: T,
  path: string,
  value: unknown
): T => set(obj, path.trim(), value);
