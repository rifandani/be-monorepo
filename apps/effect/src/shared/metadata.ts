import metadata from "../../package.json" with { type: "json" };

export const SERVICE_NAME = metadata.name;
export const SERVICE_VERSION = metadata.version;
