// 将宿主成员目录投影为 editor discussion 用户和历史头像映射。
import type { TenantMember } from "@sharebrain/contracts";
import type { TDiscussionUser } from "@sharebrain/editor";

export type EditorParticipantDirectory = {
  discussionUsers: Record<string, TDiscussionUser>;
  avatarUrls: Record<string, string>;
};

export function createEditorParticipantDirectory(
  currentUser: TenantMember,
  members: TenantMember[],
): EditorParticipantDirectory {
  const allMembers = new Map(members.map((member) => [member.id, member]));
  allMembers.set(currentUser.id, currentUser);

  const discussionUsers: Record<string, TDiscussionUser> = {};
  const avatarUrls: Record<string, string> = {};

  for (const member of allMembers.values()) {
    discussionUsers[member.id] = {
      id: member.id,
      name: member.displayName,
      avatarUrl: member.avatar.url,
    };
    avatarUrls[member.id] = member.avatar.url;
  }

  return { discussionUsers, avatarUrls };
}
