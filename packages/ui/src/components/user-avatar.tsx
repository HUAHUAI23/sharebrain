// 统一渲染用户头像、图片失败回退和稳定的 Unicode 首字符色块。
import * as React from "react"

import { Avatar, AvatarFallback, AvatarImage } from "#components/avatar"
import { cn } from "#lib/utils"

const fallbackTones = [
  "bg-blue-100 text-blue-800",
  "bg-emerald-100 text-emerald-800",
  "bg-amber-100 text-amber-900",
  "bg-rose-100 text-rose-800",
  "bg-violet-100 text-violet-800",
  "bg-cyan-100 text-cyan-900",
] as const

function stableToneIndex(value: string) {
  let hash = 0

  for (const character of value) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0
  }

  return hash % fallbackTones.length
}

function firstDisplayCharacter(name: string) {
  return Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "?"
}

type UserAvatarProps = Omit<React.ComponentProps<typeof Avatar>, "children"> & {
  name: string
  src?: string | null | undefined
  alt?: string
  fallbackKey?: string
  imageClassName?: string
  fallbackClassName?: string
}

function UserAvatar({
  name,
  src,
  alt = "",
  fallbackKey = name,
  className,
  imageClassName,
  fallbackClassName,
  ...props
}: UserAvatarProps) {
  const tone = fallbackTones[stableToneIndex(fallbackKey)]

  return (
    <Avatar className={cn("ring-1 ring-border/70", className)} {...props}>
      {src ? (
        <AvatarImage
          src={src}
          alt={alt}
          className={cn("object-cover", imageClassName)}
        />
      ) : null}
      <AvatarFallback
        delayMs={src ? 120 : 0}
        className={cn("font-medium", tone, fallbackClassName)}
      >
        {firstDisplayCharacter(name)}
      </AvatarFallback>
    </Avatar>
  )
}

export { UserAvatar, type UserAvatarProps }
