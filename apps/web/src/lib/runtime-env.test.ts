// 验证公开运行时配置的同源默认、优先级、类型约束和加载行为。
import { describe, expect, test } from "bun:test";

import {
  createSameOriginCollabUrl,
  loadClientRuntimeEnv,
  parsePublicRuntimeConfig,
  resolveClientRuntimeEnv,
} from "./runtime-env";

const httpsLocation = {
  host: "brain.example.com",
  protocol: "https:",
} as const;

describe("createSameOriginCollabUrl", () => {
  test("uses secure websockets for an HTTPS page", () => {
    expect(createSameOriginCollabUrl(httpsLocation)).toBe(
      "wss://brain.example.com/collab",
    );
  });

  test("uses plain websockets for an HTTP development page", () => {
    expect(
      createSameOriginCollabUrl({ host: "localhost:3000", protocol: "http:" }),
    ).toBe("ws://localhost:3000/collab");
  });
});

describe("resolveClientRuntimeEnv", () => {
  test("prefers runtime values over development build values", () => {
    const env = resolveClientRuntimeEnv(
      {
        WEB_PUBLIC_API_BASE_URL: "https://api.example.com",
        WEB_PUBLIC_COLLAB_WS_URL: "wss://collab.example.com",
        WEB_PUBLIC_EDITOR_WINDOWING_ENABLED: "false",
      },
      httpsLocation,
      {
        WEB_PUBLIC_API_BASE_URL: "http://localhost:3001",
        WEB_PUBLIC_COLLAB_WS_URL: "ws://localhost:3002",
        WEB_PUBLIC_EDITOR_WINDOWING_ENABLED: "true",
      },
    );

    expect(env.WEB_PUBLIC_API_BASE_URL).toBe("https://api.example.com");
    expect(env.WEB_PUBLIC_COLLAB_WS_URL).toBe("wss://collab.example.com");
    expect(env.WEB_PUBLIC_EDITOR_WINDOWING_ENABLED).toBe(false);
  });

  test("treats an explicitly empty runtime collab URL as same-origin", () => {
    const env = resolveClientRuntimeEnv(
      {
        WEB_PUBLIC_API_BASE_URL: "",
        WEB_PUBLIC_COLLAB_WS_URL: "",
      },
      httpsLocation,
      {
        WEB_PUBLIC_API_BASE_URL: "http://localhost:3001",
        WEB_PUBLIC_COLLAB_WS_URL: "ws://localhost:3002",
      },
    );

    expect(env.WEB_PUBLIC_API_BASE_URL).toBe("");
    expect(env.WEB_PUBLIC_COLLAB_WS_URL).toBe(
      "wss://brain.example.com/collab",
    );
  });

  test("uses development values when the runtime file is empty", () => {
    const env = resolveClientRuntimeEnv({}, httpsLocation, {
      WEB_PUBLIC_API_BASE_URL: "http://localhost:3001",
      WEB_PUBLIC_COLLAB_WS_URL: "ws://localhost:3002",
    });

    expect(env.WEB_PUBLIC_API_BASE_URL).toBe("http://localhost:3001");
    expect(env.WEB_PUBLIC_COLLAB_WS_URL).toBe("ws://localhost:3002");
  });
});

describe("parsePublicRuntimeConfig", () => {
  test("rejects unknown and non-string values", () => {
    expect(() => parsePublicRuntimeConfig({ UNKNOWN: "value" })).toThrow(
      "Unknown runtime configuration keys",
    );
    expect(() =>
      parsePublicRuntimeConfig({ WEB_PUBLIC_EDITOR_WINDOWING_MIN_BLOCKS: 800 }),
    ).toThrow("must be a string");
  });
});

describe("loadClientRuntimeEnv", () => {
  test("materializes the validated env before crossing a browser Promise boundary", async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: httpsLocation },
    });

    try {
      const env = await loadClientRuntimeEnv({
        fetchRuntimeConfig: () => Promise.resolve(Response.json({})),
        fallbackConfig: {},
        location: httpsLocation,
      });

      expect(await Promise.resolve(env)).toBe(env);
      expect(env.WEB_PUBLIC_COLLAB_WS_URL).toBe(
        "wss://brain.example.com/collab",
      );
    } finally {
      if (originalWindow) {
        Object.defineProperty(globalThis, "window", originalWindow);
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });

  test("loads JSON without browser caching", async () => {
    let requestInit: RequestInit | undefined;
    const env = await loadClientRuntimeEnv({
      fetchRuntimeConfig: (_input, init) => {
        requestInit = init;
        return Promise.resolve(
          Response.json({ WEB_PUBLIC_COLLAB_WS_URL: "wss://runtime.example.com/collab" }),
        );
      },
      fallbackConfig: {},
      location: httpsLocation,
    });

    expect(requestInit?.cache).toBe("no-store");
    expect(env.WEB_PUBLIC_COLLAB_WS_URL).toBe(
      "wss://runtime.example.com/collab",
    );
  });

  test("falls back only when the runtime file is absent", async () => {
    const env = await loadClientRuntimeEnv({
      fetchRuntimeConfig: () => Promise.resolve(new Response(null, { status: 404 })),
      fallbackConfig: {},
      location: httpsLocation,
    });

    expect(env.WEB_PUBLIC_COLLAB_WS_URL).toBe(
      "wss://brain.example.com/collab",
    );

    await expect(
      loadClientRuntimeEnv({
        fetchRuntimeConfig: () =>
          Promise.resolve(new Response(null, { status: 503 })),
        fallbackConfig: {},
        location: httpsLocation,
      }),
    ).rejects.toThrow("status 503");
  });
});
