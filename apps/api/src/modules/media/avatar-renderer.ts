import { Avatar, Style } from "@dicebear/core";
import notionistsNeutral from "@dicebear/styles/notionists-neutral.json" with { type: "json" };

import { GENERATED_AVATAR_VERSION } from "../shared/avatar";

const avatarStyle = new Style(notionistsNeutral);

export { GENERATED_AVATAR_VERSION };

export function renderGeneratedAvatar(seed: string) {
  return new Avatar(avatarStyle, {
    seed,
    size: 128,
    mouthVariant: "variant04",
  }).toString();
}
