import { describe, expect, it } from "vitest";

import { base64ToUint8Array, fileToDataUri } from "./converter.js";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe(base64ToUint8Array, () => {
  it("decodes a correctly padded base64 string", () => {
    expect(decode(base64ToUint8Array("SGVsbG8="))).toBe("Hello");
  });

  it("adds the padding the caller omitted", () => {
    // "SGVsbG8" is one "=" short of a whole 4-character group.
    expect(decode(base64ToUint8Array("SGVsbG8"))).toBe("Hello");
  });

  it("decodes an empty string to an empty array", () => {
    expect(base64ToUint8Array("")).toHaveLength(0);
  });

  it("translates url-safe '-' back to '+'", () => {
    // [251, 239, 190] encodes to "++++", so its url-safe form is "----".
    expect([...base64ToUint8Array("----")]).toStrictEqual([251, 239, 190]);
  });

  it("translates url-safe '_' back to '/'", () => {
    // [255, 255, 255] encodes to "////", so its url-safe form is "____".
    expect([...base64ToUint8Array("____")]).toStrictEqual([255, 255, 255]);
  });

  it("round-trips bytes outside the ascii range", () => {
    const original = new Uint8Array([0, 1, 127, 128, 254, 255]);
    const encoded = btoa(String.fromCodePoint(...original));

    expect([...base64ToUint8Array(encoded)]).toStrictEqual([...original]);
  });
});

describe(fileToDataUri, () => {
  it("uses the file's declared mime type", async () => {
    const file = new File(["hello"], "greeting.txt", { type: "text/plain" });

    await expect(fileToDataUri(file)).resolves.toBe(
      "data:text/plain;base64,aGVsbG8="
    );
  });

  it("falls back to application/octet-stream when the type is empty", async () => {
    const file = new File(["hello"], "greeting.bin");

    await expect(fileToDataUri(file)).resolves.toBe(
      "data:application/octet-stream;base64,aGVsbG8="
    );
  });

  it("encodes an empty file", async () => {
    const file = new File([], "empty.bin", { type: "text/plain" });

    await expect(fileToDataUri(file)).resolves.toBe("data:text/plain;base64,");
  });

  it("round-trips through base64ToUint8Array", async () => {
    const original = new Uint8Array([0, 128, 255, 64]);
    const file = new File([original], "bytes.bin", { type: "text/plain" });

    const dataUri = await fileToDataUri(file);
    const base64 = dataUri.split(",")[1] ?? "";

    expect([...base64ToUint8Array(base64)]).toStrictEqual([...original]);
  });
});
