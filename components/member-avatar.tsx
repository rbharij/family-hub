/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils"

interface AvatarMember {
  name?: string | null
  avatar_emoji?: string | null
  avatar_url?: string | null
  color?: string | null
}

/**
 * Round avatar for a family member: their photo if they have one,
 * otherwise their emoji, otherwise their initial, framed in their colour.
 */
export function MemberAvatar({ member, className }: { member: AvatarMember | null | undefined; className?: string }) {
  const color = member?.color ?? "#8C8279"
  const emoji = member?.avatar_emoji
  const photo = member?.avatar_url

  if (photo) {
    return (
      <span
        title={member?.name ?? undefined}
        className={cn("inline-flex shrink-0 rounded-full overflow-hidden select-none", className)}
        style={{ boxShadow: `0 0 0 2px ${color}` }}
      >
        <img src={photo} alt={member?.name ?? ""} className="size-full object-cover" draggable={false} />
      </span>
    )
  }

  return (
    <span
      title={member?.name ?? undefined}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none select-none", className)}
      style={emoji
        ? { backgroundColor: `${color}2E`, boxShadow: `inset 0 0 0 2px ${color}` }
        : { backgroundColor: color, color: "#FFFFFF" }}
    >
      {emoji ?? (member?.name?.[0]?.toUpperCase() ?? "?")}
    </span>
  )
}
