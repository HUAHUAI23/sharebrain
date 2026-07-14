// 将文档历史 actor 数据适配为无业务含义的通用用户头像。
import { UserAvatar } from "@sharebrain/ui/components/user-avatar";

export type DocumentHistoryActor = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

export function DocumentHistoryActorAvatar({
  actor,
  memberAvatarUrl,
}: {
  actor: DocumentHistoryActor;
  memberAvatarUrl?: string | undefined;
}) {
  return (
    <UserAvatar
      size="sm"
      name={actor.displayName}
      fallbackKey={actor.id}
      src={actor.avatarUrl ?? memberAvatarUrl}
    />
  );
}
