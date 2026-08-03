import { SpanStatusCode, trace } from "@opentelemetry/api";
import type {
  Attributes,
  AttributeValue,
  Span,
  SpanContext,
  Tracer,
} from "@opentelemetry/api";
import { match, P } from "ts-pattern";

import { SERVICE_NAME } from "@/core/constants/global.js";

const SMALL_ARRAY_LENGTH = 5;
const PREVIEW_LENGTH = 3;
const noopSpanContext: SpanContext = {
  spanId: "",
  traceFlags: 0,
  traceId: "",
};

const noopSpan: Span = {
  addEvent() {
    return this;
  },
  addLink() {
    return this;
  },
  addLinks() {
    return this;
  },
  end() {
    return this;
  },
  isRecording() {
    return false;
  },
  recordException() {
    return this;
  },
  setAttribute() {
    return this;
  },
  setAttributes() {
    return this;
  },
  setStatus() {
    return this;
  },
  spanContext() {
    return noopSpanContext;
  },
  updateName() {
    return this;
  },
};

/**
 * Tracer implementation that does nothing (null object).
 */
export const noopTracer: Tracer = {
  startActiveSpan<F extends (span: Span) => unknown>(
    _: unknown,
    arg1: unknown,
    arg2?: unknown,
    arg3?: F
    // oxlint-disable-next-line typescript/no-explicit-any
  ): ReturnType<any> {
    if (typeof arg1 === "function") {
      return arg1(noopSpan);
    }
    if (typeof arg2 === "function") {
      return arg2(noopSpan);
    }
    if (typeof arg3 === "function") {
      return arg3(noopSpan);
    }
  },

  startSpan(): Span {
    return noopSpan;
  },
};

/**
 * Get a tracer instance.
 *
 * @example
 * ```typescript
 * const tracer = getTracer({
 *   isEnabled: true,
 *   tracer: trace.getTracer('ai'),
 * });
 * ```
 */
export const getTracer = ({
  isEnabled = false,
  tracer,
}: {
  isEnabled?: boolean;
  tracer?: Tracer;
} = {}): Tracer => {
  if (!isEnabled) {
    return noopTracer;
  }

  if (tracer) {
    return tracer;
  }

  return trace.getTracer(SERVICE_NAME);
};

interface RecordSpanOptions<T> {
  /**
   * The name of the span.
   */
  name: string;
  /**
   * The tracer to use.
   */
  tracer: Tracer;
  /**
   * The attributes to set on the span.
   */
  attributes: Attributes;
  /**
   * The function to wrap.
   */
  fn: (span: Span) => Promise<T>;
  /**
   * Whether to end the span when the function is done.
   *
   * @default true
   */
  endWhenDone?: boolean;
}

/**
 * Marks a span as failed and ends it. The span always ends on failure,
 * regardless of `endWhenDone`.
 */
const endSpanWithError = (span: Span, error: unknown): void => {
  try {
    if (error instanceof Error) {
      span.recordException({
        message: error.message,
        name: error.name,
        stack: error.stack,
      });
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
    } else {
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
  } finally {
    span.end();
  }
};

/**
 * Wraps a function with a tracer span.
 *
 * @example
 * ```typescript
 * return recordSpan({
 *   name: 'my-function',
 *   tracer: trace.getTracer('ai'),
 *   attributes: { key: 'value' },
 *   fn: async (span) => {
 *     return 'hello';
 *   },
 *   endWhenDone: false,
 * });
 * ```
 */
export const recordSpan = <T>({
  name,
  tracer,
  attributes,
  fn,
  endWhenDone = true,
}: RecordSpanOptions<T>) =>
  tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);

      if (endWhenDone) {
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
      }

      return result;
    } catch (error) {
      endSpanWithError(span, error);
      throw error;
    }
  });

interface FlattenState {
  prefix: string;
  maxDepth: number;
  currentDepth: number;
}

/**
 * Flattens one value of a container, one level deeper than its parent. Passed
 * in rather than referenced directly so the helpers below stay independent of
 * the entry point.
 */
type FlattenValue = (
  value: unknown,
  state: FlattenState
) => Record<string, string>;

/**
 * Flattens the `[key, value]` pairs of an array or object, recursing one level
 * deeper for each value.
 */
const flattenEntries = (
  entries: Iterable<[number | string, unknown]>,
  { prefix, maxDepth, currentDepth }: FlattenState,
  flattenValue: FlattenValue
): Record<string, string> => {
  const result: Record<string, string> = {};

  for (const [key, value] of entries) {
    Object.assign(
      result,
      flattenValue(value, {
        currentDepth: currentDepth + 1,
        maxDepth,
        prefix: prefix ? `${prefix}.${key}` : String(key),
      })
    );
  }

  return result;
};

const flattenArray = (
  items: unknown[],
  state: FlattenState,
  flattenValue: FlattenValue
): Record<string, string> => {
  const { prefix } = state;

  if (items.length === 0) {
    return { [prefix]: "[]" };
  }

  if (items.length > SMALL_ARRAY_LENGTH) {
    // For large arrays, just show the count and first few items
    return {
      [`${prefix}.length`]: String(items.length),
      [`${prefix}.preview`]: `${JSON.stringify(items.slice(0, PREVIEW_LENGTH))}...`,
    };
  }

  // For small arrays, expand each item
  return flattenEntries(items.entries(), state, flattenValue);
};

const flattenRecord = (
  obj: object,
  state: FlattenState,
  flattenValue: FlattenValue
): Record<string, string> => {
  const entries = Object.entries(obj);

  return entries.length === 0
    ? { [state.prefix]: "{}" }
    : flattenEntries(entries, state, flattenValue);
};

const flattenValue: FlattenValue = (value, state) => {
  const { prefix, maxDepth, currentDepth } = state;

  if (currentDepth >= maxDepth) {
    return { [prefix]: JSON.stringify(value) };
  }

  if (value === null || value === undefined || typeof value !== "object") {
    return { [prefix]: String(value) };
  }

  return Array.isArray(value)
    ? flattenArray(value, state, flattenValue)
    : flattenRecord(value, state, flattenValue);
};

/**
 * Recursively flattens nested objects for trace attributes
 *
 * @example
 * ```typescript
 * const obj = {
 *   a: 1,
 *   b: { c: 2, d: 3 },
 * };
 * const flattened = flattenAttributes(obj);
 * // flattened = { 'a': '1', 'b.c': '2', 'b.d': '3' }
 * ```
 */
export const flattenAttributes = (
  obj: unknown,
  config?: Partial<FlattenState>
): Record<string, string> => {
  const { prefix = "", maxDepth = 3, currentDepth = 0 } = config ?? {};

  return flattenValue(obj, { currentDepth, maxDepth, prefix });
};

/**
 * Recursively flattens nested objects for trace attributes
 */
export const flattenAttributesV2 = (
  obj: Record<string, unknown>,
  prefix = ""
): Record<string, AttributeValue> =>
  Object.entries(obj).reduce(
    (acc, [key, value]) => {
      const newKey = prefix ? `${prefix}.${key}` : key;

      return (
        match(value)
          .with(P.nullish, () => acc)
          .with(P.array(), (items) => {
            const allPrimitives = items.every(
              (item) => typeof item !== "object" || item === null
            );

            if (allPrimitives) {
              // OTel doesn't support mixed-type arrays, so convert all to strings.
              acc[newKey] = items.filter((item) => item !== null).map(String);
              return acc;
            }

            for (const [i, item] of items.entries()) {
              if (typeof item === "object" && item !== null) {
                Object.assign(
                  acc,
                  flattenAttributesV2(
                    item as Record<string, unknown>,
                    `${newKey}.${i}`
                  )
                );
              } else if (item !== null && item !== undefined) {
                acc[`${newKey}.${i}`] = String(item);
              }
            }

            return acc;
          })
          .with(P.union(P.string, P.number, P.boolean), (primitive) => {
            acc[newKey] = primitive;
            return acc;
          })
          .with(
            P.when((candidate) => typeof candidate === "object"),
            (record) =>
              Object.assign(
                acc,
                flattenAttributesV2(record as Record<string, unknown>, newKey)
              )
          )
          // Anything left is a function, symbol or bigint, none of which OTel
          // can represent — the original code dropped them via a missing
          // `else`, which was easy to read as an oversight.
          .otherwise(() => acc)
      );
    },
    {} as Record<string, AttributeValue>
  );
