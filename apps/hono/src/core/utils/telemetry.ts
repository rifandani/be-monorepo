import {
  type Attributes,
  type AttributeValue,
  type Span,
  type SpanContext,
  SpanStatusCode,
  type Tracer,
  trace,
} from '@opentelemetry/api';
import { SERVICE_NAME } from '@/core/constants/global.js';

const SMALL_ARRAY_LENGTH = 5;
const PREVIEW_LENGTH = 3;

/**
 * Tracer implementation that does nothing (null object).
 */
export const noopTracer: Tracer = {
  startSpan(): Span {
    return noopSpan;
  },

  startActiveSpan<F extends (span: Span) => unknown>(
    _: unknown,
    arg1: unknown,
    arg2?: unknown,
    arg3?: F
    // biome-ignore lint/suspicious/noExplicitAny: xxx
  ): ReturnType<any> {
    if (typeof arg1 === 'function') {
      return arg1(noopSpan);
    }
    if (typeof arg2 === 'function') {
      return arg2(noopSpan);
    }
    if (typeof arg3 === 'function') {
      return arg3(noopSpan);
    }
  },
};

const noopSpan: Span = {
  spanContext() {
    return noopSpanContext;
  },
  setAttribute() {
    return this;
  },
  setAttributes() {
    return this;
  },
  addEvent() {
    return this;
  },
  addLink() {
    return this;
  },
  addLinks() {
    return this;
  },
  setStatus() {
    return this;
  },
  updateName() {
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
};

const noopSpanContext: SpanContext = {
  traceId: '',
  spanId: '',
  traceFlags: 0,
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
export function getTracer({
  isEnabled = false,
  tracer,
}: {
  isEnabled?: boolean;
  tracer?: Tracer;
} = {}): Tracer {
  if (!isEnabled) {
    return noopTracer;
  }

  if (tracer) {
    return tracer;
  }

  return trace.getTracer(SERVICE_NAME);
}

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
export function recordSpan<T>({
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
}) {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
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
            name: error.name,
            message: error.message,
            stack: error.stack ?? '',
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
}

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
export function flattenAttributes(
  obj: unknown,
  config?: {
    prefix?: string;
    maxDepth?: number;
    currentDepth?: number;
  }
): Record<string, string> {
  const result: Record<string, string> = {};
  const { prefix = '', maxDepth = 3, currentDepth = 0 } = config ?? {};

  if (currentDepth >= maxDepth) {
    result[prefix] = JSON.stringify(obj);
    return result;
  }

  if (obj === null || obj === undefined) {
    result[prefix] = String(obj);
    return result;
  }

  if (typeof obj !== 'object') {
    result[prefix] = String(obj);
    return result;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      result[prefix] = '[]';
    } else if (obj.length <= SMALL_ARRAY_LENGTH) {
      // For small arrays, expand each item
      obj.forEach((item, index) => {
        const newPrefix = prefix ? `${prefix}.${index}` : String(index);
        Object.assign(
          result,
          flattenAttributes(item, {
            prefix: newPrefix,
            maxDepth,
            currentDepth: currentDepth + 1,
          })
        );
      });
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
    result[prefix] = '{}';
    return result;
  }

  for (const [key, value] of entries) {
    const newPrefix = prefix ? `${prefix}.${key}` : key;
    Object.assign(
      result,
      flattenAttributes(value, {
        prefix: newPrefix,
        maxDepth,
        currentDepth: currentDepth + 1,
      })
    );
  }

  return result;
}

/**
 * Recursively flattens nested objects for trace attributes
 */
export function flattenAttributesV2(
  obj: Record<string, unknown>,
  prefix = ''
): Record<string, AttributeValue> {
  return Object.entries(obj).reduce(
    (acc, [key, value]) => {
      const newKey = prefix ? `${prefix}.${key}` : key;
      if (value === null || value === undefined) {
        return acc;
      }
      if (Array.isArray(value)) {
        const allPrimitives = value.every(
          (item) => typeof item !== 'object' || item === null
        );
        if (allPrimitives) {
          // OTel doesn't support mixed-type arrays, so convert all to strings.
          acc[newKey] = value
            .filter((item) => item !== null)
            .map((item) => String(item));
        } else {
          value.forEach((item, i) => {
            if (typeof item === 'object' && item !== null) {
              // biome-ignore lint/performance/noAccumulatingSpread: xxx
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
          });
        }
      } else if (typeof value === 'object') {
        // biome-ignore lint/performance/noAccumulatingSpread: xxx
        Object.assign(
          acc,
          flattenAttributesV2(value as Record<string, unknown>, newKey)
        );
      } else if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        acc[newKey] = value;
      }
      return acc;
    },
    {} as Record<string, AttributeValue>
  );
}
