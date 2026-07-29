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
}: {
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
}) =>
  tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);

      if (endWhenDone) {
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
      }

      return result;
    } catch (error) {
      try {
        if (error instanceof Error) {
          span.recordException({
            message: error.message,
            name: error.name,
            stack: error.stack ?? "",
          });
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
        } else {
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
      } finally {
        // always stop the span when there is an error:
        span.end();
      }

      throw error;
    }
  });

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
  config?: {
    prefix?: string;
    maxDepth?: number;
    currentDepth?: number;
  }
): Record<string, string> => {
  const result: Record<string, string> = {};
  const { prefix = "", maxDepth = 3, currentDepth = 0 } = config ?? {};

  if (currentDepth >= maxDepth) {
    result[prefix] = JSON.stringify(obj);
    return result;
  }

  if (obj === null || obj === undefined) {
    result[prefix] = String(obj);
    return result;
  }

  if (typeof obj !== "object") {
    result[prefix] = String(obj);
    return result;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      result[prefix] = "[]";
    } else if (obj.length <= SMALL_ARRAY_LENGTH) {
      // For small arrays, expand each item
      for (const [index, item] of obj.entries()) {
        const newPrefix = prefix ? `${prefix}.${index}` : String(index);
        Object.assign(
          result,
          flattenAttributes(item, {
            currentDepth: currentDepth + 1,
            maxDepth,
            prefix: newPrefix,
          })
        );
      }
    } else {
      // For large arrays, just show the count and first few items
      result[`${prefix}.length`] = String(obj.length);
      result[`${prefix}.preview`] =
        `${JSON.stringify(obj.slice(0, PREVIEW_LENGTH))}...`;
    }
    return result;
  }

  // Handle regular objects
  const entries = Object.entries(obj);
  if (entries.length === 0) {
    result[prefix] = "{}";
    return result;
  }

  for (const [key, value] of entries) {
    const newPrefix = prefix ? `${prefix}.${key}` : key;
    Object.assign(
      result,
      flattenAttributes(value, {
        currentDepth: currentDepth + 1,
        maxDepth,
        prefix: newPrefix,
      })
    );
  }

  return result;
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
