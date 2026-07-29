import { describe, expect, it } from "vitest";

import {
  clamp,
  deepReadObject,
  indonesianPhoneNumberFormat,
  objectToFormData,
  objectToFormDataArrayWithComma,
  removeLeadingWhitespace,
  removeLeadingZeros,
  toCamelCase,
  toSnakeCase,
} from "./core";

describe(clamp, () => {
  it("returns the value untouched when it is already within range", () => {
    expect(clamp({ max: 10, min: 0, value: 5 })).toBe(5);
  });

  it("returns the bound when the value sits exactly on it", () => {
    expect(clamp({ max: 10, min: 0, value: 0 })).toBe(0);
    expect(clamp({ max: 10, min: 0, value: 10 })).toBe(10);
  });

  it("clamps to max when the value is above range", () => {
    expect(clamp({ max: 10, min: 0, value: 12 })).toBe(10);
  });

  it("clamps to min when the value is below range", () => {
    expect(clamp({ max: 10, min: 0, value: -5 })).toBe(0);
  });

  it("handles negative ranges", () => {
    expect(clamp({ max: -5, min: -10, value: -20 })).toBe(-10);
    expect(clamp({ max: -5, min: -10, value: 0 })).toBe(-5);
  });

  it("collapses to the single value when min equals max", () => {
    expect(clamp({ max: 3, min: 3, value: 99 })).toBe(3);
  });
});

describe(indonesianPhoneNumberFormat, () => {
  it("formats the 8-digit subscriber number from the documented example", () => {
    expect(indonesianPhoneNumberFormat("+6281273636365")).toBe(
      "+62-812-7363-6365"
    );
  });

  it("formats a 7-digit subscriber number as 3-4", () => {
    expect(indonesianPhoneNumberFormat("+628127363636")).toBe(
      "+62-812-736-3636"
    );
  });

  it("formats a 6-digit-or-shorter subscriber number as 3-rest", () => {
    expect(indonesianPhoneNumberFormat("+62812736363")).toBe("+62-812-736-363");
  });

  it("formats a 9-digit-or-longer subscriber number as 4-rest", () => {
    expect(indonesianPhoneNumberFormat("+62812736363651")).toBe(
      "+62-812-7363-63651"
    );
  });
});

describe(toCamelCase, () => {
  it("converts snake_case keys", () => {
    expect(toCamelCase({ first_name: "ada" })).toStrictEqual({
      firstName: "ada",
    });
  });

  it("converts kebab-case keys", () => {
    expect(toCamelCase({ "first-name": "ada" })).toStrictEqual({
      firstName: "ada",
    });
  });

  it("strips a single leading underscore", () => {
    expect(toCamelCase({ _private_key: 1 })).toStrictEqual({ privateKey: 1 });
  });

  it("converts nested objects and arrays", () => {
    expect(
      toCamelCase({ outer_key: { inner_list: [{ leaf_key: 1 }] } })
    ).toStrictEqual({ outerKey: { innerList: [{ leafKey: 1 }] } });
  });

  it("drops keys whose value is undefined", () => {
    expect(toCamelCase({ kept_key: 1, missing_key: undefined })).toStrictEqual({
      keptKey: 1,
    });
  });

  it("preserves class instances rather than emptying them", () => {
    const date = new Date(0);
    const result = toCamelCase<{ createdAt: Date }>({ created_at: date });

    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.createdAt.getTime()).toBe(0);
  });

  it("passes primitives and null through untouched", () => {
    expect(toCamelCase("plain")).toBe("plain");
    expect(toCamelCase(7)).toBe(7);
    expect(toCamelCase(null)).toBeNull();
  });
});

describe(toSnakeCase, () => {
  it("converts camelCase keys", () => {
    expect(toSnakeCase({ firstName: "ada" })).toStrictEqual({
      first_name: "ada",
    });
  });

  it("converts nested objects and arrays", () => {
    expect(
      toSnakeCase({ outerKey: { innerList: [{ leafKey: 1 }] } })
    ).toStrictEqual({
      outer_key: { inner_list: [{ leaf_key: 1 }] },
    });
  });

  it("drops keys whose value is undefined", () => {
    expect(toSnakeCase({ keptKey: 1, missingKey: undefined })).toStrictEqual({
      kept_key: 1,
    });
  });

  it("preserves class instances rather than emptying them", () => {
    const date = new Date(0);
    const result = toSnakeCase<{ created_at: Date }>({ createdAt: date });

    expect(result.created_at).toBeInstanceOf(Date);
    expect(result.created_at.getTime()).toBe(0);
  });

  it("collapses a run of capitals into one segment, so it is not the inverse of toCamelCase", () => {
    expect(toSnakeCase({ userID: 1 })).toStrictEqual({ user_id: 1 });
    expect(toCamelCase(toSnakeCase({ userID: 1 }))).toStrictEqual({
      userId: 1,
    });
  });
});

describe(removeLeadingZeros, () => {
  it("removes a single zero when a non-zero digit follows", () => {
    expect(removeLeadingZeros("0012")).toBe("012");
    expect(removeLeadingZeros("007")).toBe("07");
  });

  it("collapses a run of zeros when no non-zero digit follows", () => {
    expect(removeLeadingZeros("000")).toBe("0");
  });

  it("leaves a lone zero alone", () => {
    expect(removeLeadingZeros("0")).toBe("0");
  });

  it("leaves values without leading zeros alone", () => {
    expect(removeLeadingZeros("123")).toBe("123");
    expect(removeLeadingZeros("0.5")).toBe("0.5");
  });
});

describe(removeLeadingWhitespace, () => {
  it("removes leading whitespace", () => {
    expect(removeLeadingWhitespace("   hello")).toBe("hello");
    expect(removeLeadingWhitespace("\t\nhello")).toBe("hello");
  });

  it("empties an all-whitespace string", () => {
    expect(removeLeadingWhitespace("   ")).toBe("");
  });

  it("returns an empty string for empty or absent input", () => {
    expect(removeLeadingWhitespace("")).toBe("");
    expect(removeLeadingWhitespace()).toBe("");
  });

  it("preserves trailing and interior whitespace", () => {
    expect(removeLeadingWhitespace("  a b  ")).toBe("a b  ");
  });
});

describe(objectToFormData, () => {
  it("flattens the documented example", () => {
    const file = new File(["foo"], "foo.txt", { type: "text/plain" });
    const formData = objectToFormData({
      another_object: { name: "my_name", value: "whatever" },
      array: [{ nested_key1: { name: "key1" } }],
      date: new Date(0),
      empty: "",
      falseBool: false,
      file,
      name: "str",
      nullable: null,
      num: 1,
      trueBool: true,
      und: undefined,
    });

    // `date`, `nullable` and `und` are absent by design — see the JSDoc example.
    expect([...formData.entries()]).toStrictEqual([
      ["another_object.name", "my_name"],
      ["another_object.value", "whatever"],
      ["array[0].nested_key1.name", "key1"],
      ["empty", ""],
      ["falseBool", "false"],
      ["file", file],
      ["name", "str"],
      ["num", "1"],
      ["trueBool", "true"],
    ]);
  });

  it("indexes array members individually", () => {
    const formData = objectToFormData({ tags: ["a", "b"] });

    expect([...formData.entries()]).toStrictEqual([
      ["tags[0]", "a"],
      ["tags[1]", "b"],
    ]);
  });

  it("prefixes every key with rootName", () => {
    const formData = objectToFormData({ a: 1 }, { rootName: "root" });

    expect([...formData.entries()]).toStrictEqual([["root.a", "1"]]);
  });

  it("skips keys listed in ignoreList", () => {
    const formData = objectToFormData(
      { keep: 1, skip: 2 },
      {
        ignoreList: ["skip"],
      }
    );

    expect([...formData.entries()]).toStrictEqual([["keep", "1"]]);
  });
});

describe(objectToFormDataArrayWithComma, () => {
  it("joins array members with a comma instead of indexing them", () => {
    const formData = objectToFormDataArrayWithComma({
      array: ["value1", "value2"],
      name: "str",
    });

    expect([...formData.entries()]).toStrictEqual([
      ["array", "value1,value2"],
      ["name", "str"],
    ]);
  });

  it("still flattens nested objects", () => {
    const formData = objectToFormDataArrayWithComma({
      another_object: { name: "my_name" },
    });

    expect([...formData.entries()]).toStrictEqual([
      ["another_object.name", "my_name"],
    ]);
  });

  it("appends a File as-is rather than stringifying it", () => {
    const file = new File(["contents"], "note.txt", { type: "text/plain" });

    const formData = objectToFormDataArrayWithComma({ file });

    expect(formData.get("file")).toBe(file);
  });
});

describe(deepReadObject, () => {
  const obj = { a: { b: { c: "hello" } } };

  it("reads a nested value by path", () => {
    expect(deepReadObject(obj, "a.b.c")).toBe("hello");
  });

  it("returns undefined when the path is absent and no default is given", () => {
    expect(deepReadObject(obj, "a.b.d")).toBeUndefined();
  });

  it("returns the default when the path is absent", () => {
    expect(deepReadObject(obj, "a.b.d", "not found")).toBe("not found");
  });

  it("returns the default when the path resolves through a missing branch", () => {
    expect(deepReadObject(obj, "x.y.z", "not found")).toBe("not found");
  });

  it("trims surrounding whitespace from the path", () => {
    expect(deepReadObject(obj, "  a.b.c  ")).toBe("hello");
  });

  it("returns falsy values as found rather than falling back", () => {
    // Collected and compared as a whole so each value is asserted exactly.
    // A per-value toBeFalsy() would also pass on undefined — i.e. on the very
    // fallback this test exists to rule out.
    const found = [
      deepReadObject({ a: { b: false } }, "a.b", "dflt"),
      deepReadObject({ a: { b: 0 } }, "a.b", "dflt"),
      deepReadObject({ a: { b: "" } }, "a.b", "dflt"),
    ];

    expect(found).toStrictEqual([false, 0, ""]);
  });

  it("treats a resolved null as absent, unlike dlv", () => {
    expect(deepReadObject({ a: null }, "a", "dflt")).toBe("dflt");
  });
});
