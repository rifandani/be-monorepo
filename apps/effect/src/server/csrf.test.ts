import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";

import { isCrossSiteFormPost } from "./csrf.ts";

const ALLOWED = "https://effect.be-monorepo.localhost";
const FOREIGN = "https://evil.example";
const FORM = "application/x-www-form-urlencoded";

const SafeMethod = Schema.Literals(["GET", "HEAD", "OPTIONS"]);
const UnsafeMethod = Schema.Literals(["POST", "PUT", "PATCH", "DELETE"]);

const FormContentType = Schema.Literals([
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
]);

const FetchSite = Schema.Literals(["cross-site", "same-site", "none"]);

const post = (headers: Record<string, string>) => ({
  headers,
  method: "POST",
});

describe(isCrossSiteFormPost, () => {
  it("refuses a form post from another origin", () => {
    assert.isTrue(
      isCrossSiteFormPost(
        post({ "content-type": FORM, origin: FOREIGN }),
        ALLOWED
      )
    );
  });

  it("refuses a form post without an origin", () => {
    assert.isTrue(isCrossSiteFormPost(post({ "content-type": FORM }), ALLOWED));
  });

  it("treats a body without a content type as text/plain", () => {
    assert.isTrue(isCrossSiteFormPost(post({ origin: FOREIGN }), ALLOWED));
  });

  it("matches a form content type in any case and with parameters", () => {
    assert.isTrue(
      isCrossSiteFormPost(
        post({
          "content-type": "Multipart/Form-Data; boundary=x",
          origin: FOREIGN,
        }),
        ALLOWED
      )
    );
  });

  it("allows a form post from the allowed origin", () => {
    assert.isFalse(
      isCrossSiteFormPost(
        post({ "content-type": FORM, origin: ALLOWED }),
        ALLOWED
      )
    );
  });

  it("allows a form post the browser marks same-origin", () => {
    assert.isFalse(
      isCrossSiteFormPost(
        post({
          "content-type": FORM,
          origin: FOREIGN,
          "sec-fetch-site": "same-origin",
        }),
        ALLOWED
      )
    );
  });

  it("allows a JSON body from another origin, which needs a CORS preflight", () => {
    assert.isFalse(
      isCrossSiteFormPost(
        post({ "content-type": "application/json", origin: FOREIGN }),
        ALLOWED
      )
    );
  });

  it.prop(
    "should never refuse a safe method",
    [SafeMethod, FormContentType, Schema.String],
    ([method, contentType, origin]) => {
      assert.isFalse(
        isCrossSiteFormPost(
          { headers: { "content-type": contentType, origin }, method },
          ALLOWED
        )
      );
    }
  );

  it.prop(
    "should never refuse a request from the allowed origin",
    [UnsafeMethod, Schema.String, FetchSite],
    ([method, contentType, fetchSite]) => {
      assert.isFalse(
        isCrossSiteFormPost(
          {
            headers: {
              "content-type": contentType,
              origin: ALLOWED,
              "sec-fetch-site": fetchSite,
            },
            method,
          },
          ALLOWED
        )
      );
    }
  );

  it.prop(
    "should always refuse a cross-site form post from another origin",
    [UnsafeMethod, FormContentType, FetchSite, Schema.String],
    ([method, contentType, fetchSite, origin]) => {
      assert.strictEqual(
        isCrossSiteFormPost(
          {
            headers: {
              "content-type": contentType,
              origin,
              "sec-fetch-site": fetchSite,
            },
            method,
          },
          ALLOWED
        ),
        origin !== ALLOWED
      );
    }
  );
});
