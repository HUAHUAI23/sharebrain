// 验证默认生成头像保持中性闭口表情，并在视觉策略变化时刷新缓存版本。
import { describe, expect, test } from "bun:test";

import { GENERATED_AVATAR_VERSION, renderGeneratedAvatar } from "./avatar-renderer";

const neutralMouthPath = "M130.4 83.6a47 47 0 0 1 28.5-7.8c6.2.5 10.7 3.5 11 9.9.3 7.4-5.7 7-10.8 7.1h-24c-5.5-.3-7.8-3-4.7-9.2";

describe("generated avatar", () => {
  test("uses the neutral closed mouth and the matching cache version", () => {
    const svg = renderGeneratedAvatar("default-user");

    expect(svg).toContain(neutralMouthPath);
    expect(GENERATED_AVATAR_VERSION).toBe("notionists-neutral-v2");
  });
});
