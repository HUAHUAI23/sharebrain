// 在应用渲染前加载公开部署配置，并为同源 API/Collab 提供可移植默认值。
import { loadClientEnv, type ClientEnv } from "@sharebrain/config";

const runtimeConfigPath = "/runtime-config.json";
const runtimeConfigKeys = [
  "WEB_PUBLIC_API_BASE_URL",
  "WEB_PUBLIC_COLLAB_WS_URL",
  "WEB_PUBLIC_EDITOR_WINDOWING_ENABLED",
  "WEB_PUBLIC_EDITOR_WINDOWING_MIN_BLOCKS",
  "WEB_PUBLIC_EDITOR_WINDOWING_LONG_TASK_MS",
  "WEB_PUBLIC_EDITOR_WINDOWING_MAX_FALLBACK_RATIO",
  "WEB_PUBLIC_EDITOR_WINDOWING_MAX_REVEAL_FAILURES",
] as const;

type RuntimeConfigKey = (typeof runtimeConfigKeys)[number];
export type PublicRuntimeConfig = Partial<Record<RuntimeConfigKey, string>>;
type RuntimeLocation = Pick<Location, "host" | "protocol">;
type FetchRuntimeConfig = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const runtimeConfigKeySet = new Set<string>(runtimeConfigKeys);
const buildTimeConfig: PublicRuntimeConfig = import.meta.env.DEV
  ? {
      WEB_PUBLIC_API_BASE_URL: import.meta.env.WEB_PUBLIC_API_BASE_URL,
      WEB_PUBLIC_COLLAB_WS_URL: import.meta.env.WEB_PUBLIC_COLLAB_WS_URL,
      WEB_PUBLIC_EDITOR_WINDOWING_ENABLED:
        import.meta.env.WEB_PUBLIC_EDITOR_WINDOWING_ENABLED,
      WEB_PUBLIC_EDITOR_WINDOWING_MIN_BLOCKS:
        import.meta.env.WEB_PUBLIC_EDITOR_WINDOWING_MIN_BLOCKS,
      WEB_PUBLIC_EDITOR_WINDOWING_LONG_TASK_MS:
        import.meta.env.WEB_PUBLIC_EDITOR_WINDOWING_LONG_TASK_MS,
      WEB_PUBLIC_EDITOR_WINDOWING_MAX_FALLBACK_RATIO:
        import.meta.env.WEB_PUBLIC_EDITOR_WINDOWING_MAX_FALLBACK_RATIO,
      WEB_PUBLIC_EDITOR_WINDOWING_MAX_REVEAL_FAILURES:
        import.meta.env.WEB_PUBLIC_EDITOR_WINDOWING_MAX_REVEAL_FAILURES,
    }
  : {};

function getCurrentLocation(): RuntimeLocation {
  if (typeof window !== "undefined") return window.location;

  return { host: "localhost:3000", protocol: "http:" };
}

function selectedValue(
  runtimeConfig: PublicRuntimeConfig,
  fallbackConfig: PublicRuntimeConfig,
  key: RuntimeConfigKey,
) {
  return Object.hasOwn(runtimeConfig, key)
    ? runtimeConfig[key]
    : fallbackConfig[key];
}

function nonEmpty(value: string | undefined, fallback: string) {
  return value?.trim() ? value : fallback;
}

export function createSameOriginCollabUrl(location: RuntimeLocation) {
  const websocketUrl = new URL("/collab", `${location.protocol}//${location.host}`);
  websocketUrl.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return websocketUrl.toString();
}

export function parsePublicRuntimeConfig(payload: unknown): PublicRuntimeConfig {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Runtime configuration must be a JSON object");
  }

  const record = payload as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => !runtimeConfigKeySet.has(key));

  if (unknownKeys.length > 0) {
    throw new TypeError(`Unknown runtime configuration keys: ${unknownKeys.join(", ")}`);
  }

  const config: PublicRuntimeConfig = {};

  for (const key of runtimeConfigKeys) {
    const value = record[key];
    if (value === undefined) continue;
    if (typeof value !== "string") {
      throw new TypeError(`Runtime configuration ${key} must be a string`);
    }
    config[key] = value;
  }

  return config;
}

export function resolveClientRuntimeEnv(
  runtimeConfig: PublicRuntimeConfig,
  location: RuntimeLocation,
  fallbackConfig: PublicRuntimeConfig = buildTimeConfig,
) {
  const validatedEnv = loadClientEnv({
    WEB_PUBLIC_API_BASE_URL:
      selectedValue(runtimeConfig, fallbackConfig, "WEB_PUBLIC_API_BASE_URL") ?? "",
    WEB_PUBLIC_COLLAB_WS_URL: nonEmpty(
      selectedValue(runtimeConfig, fallbackConfig, "WEB_PUBLIC_COLLAB_WS_URL"),
      createSameOriginCollabUrl(location),
    ),
    WEB_PUBLIC_EDITOR_WINDOWING_ENABLED: nonEmpty(
      selectedValue(runtimeConfig, fallbackConfig, "WEB_PUBLIC_EDITOR_WINDOWING_ENABLED"),
      "true",
    ),
    WEB_PUBLIC_EDITOR_WINDOWING_MIN_BLOCKS: nonEmpty(
      selectedValue(runtimeConfig, fallbackConfig, "WEB_PUBLIC_EDITOR_WINDOWING_MIN_BLOCKS"),
      "800",
    ),
    WEB_PUBLIC_EDITOR_WINDOWING_LONG_TASK_MS: nonEmpty(
      selectedValue(runtimeConfig, fallbackConfig, "WEB_PUBLIC_EDITOR_WINDOWING_LONG_TASK_MS"),
      "200",
    ),
    WEB_PUBLIC_EDITOR_WINDOWING_MAX_FALLBACK_RATIO: nonEmpty(
      selectedValue(
        runtimeConfig,
        fallbackConfig,
        "WEB_PUBLIC_EDITOR_WINDOWING_MAX_FALLBACK_RATIO",
      ),
      "0.25",
    ),
    WEB_PUBLIC_EDITOR_WINDOWING_MAX_REVEAL_FAILURES: nonEmpty(
      selectedValue(
        runtimeConfig,
        fallbackConfig,
        "WEB_PUBLIC_EDITOR_WINDOWING_MAX_REVEAL_FAILURES",
      ),
      "3",
    ),
  });

  return Object.freeze({
    WEB_PUBLIC_API_BASE_URL: validatedEnv.WEB_PUBLIC_API_BASE_URL,
    WEB_PUBLIC_COLLAB_WS_URL: validatedEnv.WEB_PUBLIC_COLLAB_WS_URL,
    WEB_PUBLIC_EDITOR_WINDOWING_ENABLED:
      validatedEnv.WEB_PUBLIC_EDITOR_WINDOWING_ENABLED,
    WEB_PUBLIC_EDITOR_WINDOWING_MIN_BLOCKS:
      validatedEnv.WEB_PUBLIC_EDITOR_WINDOWING_MIN_BLOCKS,
    WEB_PUBLIC_EDITOR_WINDOWING_LONG_TASK_MS:
      validatedEnv.WEB_PUBLIC_EDITOR_WINDOWING_LONG_TASK_MS,
    WEB_PUBLIC_EDITOR_WINDOWING_MAX_FALLBACK_RATIO:
      validatedEnv.WEB_PUBLIC_EDITOR_WINDOWING_MAX_FALLBACK_RATIO,
    WEB_PUBLIC_EDITOR_WINDOWING_MAX_REVEAL_FAILURES:
      validatedEnv.WEB_PUBLIC_EDITOR_WINDOWING_MAX_REVEAL_FAILURES,
  }) satisfies ClientEnv;
}

export async function loadClientRuntimeEnv({
  fetchRuntimeConfig = globalThis.fetch,
  location = getCurrentLocation(),
  fallbackConfig = buildTimeConfig,
}: {
  fetchRuntimeConfig?: FetchRuntimeConfig;
  location?: RuntimeLocation;
  fallbackConfig?: PublicRuntimeConfig;
} = {}) {
  const response = await fetchRuntimeConfig(runtimeConfigPath, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });

  if (response.status === 404) {
    return resolveClientRuntimeEnv({}, location, fallbackConfig);
  }

  if (!response.ok) {
    throw new Error(`Runtime configuration request failed with status ${response.status}`);
  }

  const config = parsePublicRuntimeConfig(await response.json());
  return resolveClientRuntimeEnv(config, location, fallbackConfig);
}

export let runtimeEnv: ClientEnv = resolveClientRuntimeEnv(
  {},
  getCurrentLocation(),
  buildTimeConfig,
);

export async function initializeRuntimeEnv() {
  runtimeEnv = await loadClientRuntimeEnv();
  return runtimeEnv;
}
