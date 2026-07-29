import type { Span } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";

import {
  flattenAttributes,
  flattenAttributesV2,
  getTracer,
  noopTracer,
  recordSpan,
} from "./telemetry.js";

describe(getTracer, () => {
  it("returns the noop tracer when tracing is disabled", () => {
    expect(getTracer()).toBe(noopTracer);
    expect(getTracer({ isEnabled: false })).toBe(noopTracer);
  });

  it("returns the caller's tracer when one is supplied", () => {
    expect(getTracer({ isEnabled: true, tracer: noopTracer })).toBe(noopTracer);
  });

  it("falls back to the global tracer when enabled without one", () => {
    const tracer = getTracer({ isEnabled: true });

    expect(tracer).not.toBe(noopTracer);
    expect(tracer.startSpan).toBeTypeOf("function");
  });
});

// Titled as a string rather than the value: `noopTracer` is an object, not a
// function, so it is not a valid `describe` subject.
describe("the noop tracer", () => {
  it("invokes the callback when it is the second argument", () => {
    expect(
      noopTracer.startActiveSpan("span", (span) => span.isRecording())
    ).toBeFalsy();
  });

  it("invokes the callback when it is the third argument", () => {
    expect(noopTracer.startActiveSpan("span", {}, () => "from-arg2")).toBe(
      "from-arg2"
    );
  });

  it("invokes the callback when it is the fourth argument", () => {
    expect(
      noopTracer.startActiveSpan("span", {}, {} as never, () => "from-arg3")
    ).toBe("from-arg3");
  });

  it("returns undefined when no callback is supplied", () => {
    expect(
      noopTracer.startActiveSpan("span", {}, {} as never, undefined as never)
    ).toBeUndefined();
  });

  it("returns a span whose lifecycle methods are chainable no-ops", () => {
    const span = noopTracer.startSpan("span");

    expect(span.addEvent("event")).toBe(span);
    expect(span.addLink({ context: span.spanContext() })).toBe(span);
    expect(span.addLinks([{ context: span.spanContext() }])).toBe(span);
    expect(span.end()).toBe(span);
    expect(span.recordException(new Error("boom"))).toBe(span);
  });

  it("returns a span whose mutators are chainable no-ops", () => {
    const span = noopTracer.startSpan("span");

    expect(span.setAttribute("key", "value")).toBe(span);
    expect(span.setAttributes({ key: "value" })).toBe(span);
    expect(span.setStatus({ code: 0 })).toBe(span);
    expect(span.updateName("renamed")).toBe(span);
  });

  it("reports that it is not recording and carries a zeroed span context", () => {
    const span = noopTracer.startSpan("span");

    expect(span.isRecording()).toBeFalsy();
    expect(span.spanContext()).toStrictEqual({
      spanId: "",
      traceFlags: 0,
      traceId: "",
    });
  });
});

const record = <T>(
  fn: (span: Span) => Promise<T>,
  endWhenDone?: boolean
): Promise<T> =>
  recordSpan({
    attributes: { "test.attribute": "value" },
    endWhenDone,
    fn,
    name: "test-span",
    tracer: noopTracer,
  });

describe(recordSpan, () => {
  it("resolves with the wrapped function's result", async () => {
    await expect(record(() => Promise.resolve("result"))).resolves.toBe(
      "result"
    );
  });

  it("passes the span into the wrapped function", async () => {
    await expect(
      record((span) => Promise.resolve(span.isRecording()))
    ).resolves.toBeFalsy();
  });

  it("skips ending the span when endWhenDone is false", async () => {
    await expect(
      record(() => Promise.resolve("kept-open"), false)
    ).resolves.toBe("kept-open");
  });

  it("rethrows an Error after recording it on the span", async () => {
    await expect(
      record(() => Promise.reject(new Error("wrapped failure")))
    ).rejects.toThrow(/^wrapped failure$/u);
  });

  it("rethrows a non-Error rejection", async () => {
    // Exercises the branch that cannot call `recordException`, because the
    // thrown value has no message, name, or stack to record. Rejecting with a
    // non-Error is the whole point of the case.
    // oxlint-disable-next-line eslint/prefer-promise-reject-errors
    await expect(record(() => Promise.reject("string failure"))).rejects.toBe(
      "string failure"
    );
  });
});

describe(flattenAttributes, () => {
  it("stringifies a bare primitive under the empty prefix", () => {
    expect(flattenAttributes(1)).toStrictEqual({ "": "1" });
    expect(flattenAttributes("text")).toStrictEqual({ "": "text" });
    expect(flattenAttributes(true)).toStrictEqual({ "": "true" });
  });

  it("stringifies null and undefined", () => {
    // Held in a variable so the linter does not strip the argument entirely;
    // `obj` is required, so `flattenAttributes()` would not typecheck.
    const absent: unknown = undefined;

    expect(flattenAttributes(null)).toStrictEqual({ "": "null" });
    expect(flattenAttributes(absent)).toStrictEqual({ "": "undefined" });
  });

  it("marks an empty array and an empty object", () => {
    expect(flattenAttributes([])).toStrictEqual({ "": "[]" });
    expect(flattenAttributes({})).toStrictEqual({ "": "{}" });
  });

  it("expands a small array item by item", () => {
    expect(flattenAttributes([1, "two"], { prefix: "items" })).toStrictEqual({
      "items.0": "1",
      "items.1": "two",
    });
  });

  it("indexes a small array without a prefix", () => {
    expect(flattenAttributes([1, 2])).toStrictEqual({ "0": "1", "1": "2" });
  });

  it("summarises an array longer than five entries", () => {
    expect(
      flattenAttributes([1, 2, 3, 4, 5, 6], { prefix: "items" })
    ).toStrictEqual({
      "items.length": "6",
      "items.preview": "[1,2,3]...",
    });
  });

  it("walks nested objects into dotted keys", () => {
    expect(flattenAttributes({ a: 1, b: { c: 2, d: 3 } })).toStrictEqual({
      a: "1",
      "b.c": "2",
      "b.d": "3",
    });
  });

  it("stops at maxDepth and serialises the remainder", () => {
    expect(flattenAttributes({ a: { b: { c: { d: 1 } } } })).toStrictEqual({
      "a.b.c": '{"d":1}',
    });
  });

  it("serialises immediately when maxDepth is already reached", () => {
    expect(
      flattenAttributes({ a: 1 }, { maxDepth: 0, prefix: "root" })
    ).toStrictEqual({ root: '{"a":1}' });
  });
});

describe(flattenAttributesV2, () => {
  it("keeps primitives at their native type", () => {
    expect(
      flattenAttributesV2({ flag: true, count: 2, name: "hono" })
    ).toStrictEqual({ count: 2, flag: true, name: "hono" });
  });

  it("drops null and undefined values", () => {
    expect(
      flattenAttributesV2({ absent: undefined, empty: null })
    ).toStrictEqual({});
  });

  it("drops values OTel cannot represent", () => {
    // A bigint is neither an object nor a string/number/boolean, so it falls
    // through every branch and is omitted rather than coerced.
    expect(flattenAttributesV2({ huge: 1n })).toStrictEqual({});
  });

  it("stringifies an all-primitive array and filters its nulls", () => {
    expect(flattenAttributesV2({ tags: [1, "two", null, true] })).toStrictEqual(
      {
        tags: ["1", "two", "true"],
      }
    );
  });

  it("indexes an array that mixes objects and primitives", () => {
    expect(
      flattenAttributesV2({ items: [{ id: 1 }, "loose", null] })
    ).toStrictEqual({
      "items.0.id": 1,
      "items.1": "loose",
    });
  });

  it("walks nested objects into dotted keys", () => {
    expect(flattenAttributesV2({ user: { id: 7, name: "ada" } })).toStrictEqual(
      {
        "user.id": 7,
        "user.name": "ada",
      }
    );
  });

  it("prefixes every key when a prefix is supplied", () => {
    expect(flattenAttributesV2({ id: 7 }, "user")).toStrictEqual({
      "user.id": 7,
    });
  });
});
