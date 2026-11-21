import metadata from "../../../package.json" with { type: "json" };

export const PORT = Number(process.env.PORT);
export const SERVICE_NAME = metadata.name;
export const SERVICE_VERSION = metadata.version;
