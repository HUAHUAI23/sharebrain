// 验证评论和历史头像目录覆盖全部成员，并始终以当前用户资料为准。
import { describe, expect, test } from "bun:test";
import type { TenantMember } from "@sharebrain/contracts";

import { createEditorParticipantDirectory } from "./editor-participants";

function member(id: string, displayName: string, avatarUrl: string): TenantMember {
  return {
    id,
    displayName,
    email: `${id}@example.com`,
    avatar: {
      kind: "generated",
      url: avatarUrl,
      version: "test",
      byteSize: null,
    },
  };
}

describe("editor participant directory", () => {
  test("maps all members to discussion users and history avatar urls", () => {
    const current = member("current", "Current", "/avatar/current");
    const collaborator = member("collaborator", "Collaborator", "/avatar/collaborator");

    expect(createEditorParticipantDirectory(current, [collaborator])).toEqual({
      discussionUsers: {
        current: {
          id: "current",
          name: "Current",
          avatarUrl: "/avatar/current",
        },
        collaborator: {
          id: "collaborator",
          name: "Collaborator",
          avatarUrl: "/avatar/collaborator",
        },
      },
      avatarUrls: {
        current: "/avatar/current",
        collaborator: "/avatar/collaborator",
      },
    });
  });

  test("uses current user data when the members result is missing or stale", () => {
    const current = member("current", "Current", "/avatar/current");
    const stale = member("current", "Old name", "/avatar/old");

    expect(createEditorParticipantDirectory(current, []).discussionUsers.current?.avatarUrl).toBe(
      "/avatar/current",
    );
    expect(
      createEditorParticipantDirectory(current, [stale]).discussionUsers.current,
    ).toMatchObject({ name: "Current", avatarUrl: "/avatar/current" });
  });
});
