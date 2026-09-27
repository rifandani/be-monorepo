import metadata from "../package.json" with { type: "json" };

/** The OpenAPI title and version, taken from the package rather than the environment. */
export const SERVICE_NAME = metadata.name;
export const SERVICE_VERSION = metadata.version;
