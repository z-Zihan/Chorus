import { resolve } from "node:path";

export * from "./loader.js";
export * from "./types.js";

export const DEFAULT_PLUGIN_DIR = resolve(process.cwd(), "plugins");
