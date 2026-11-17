import { cn } from "@/lib/utils"

interface AvatarMember {
  name?: string | null
  avatar_emoji?: string | null
  color?: string | null
}

/** Coloured circle for a family member: their emoji if set, otherwise their initial. */
export function MemberAvatar({ member, className }: { member: AvatarMember | null | undefined; className?: string }) {
  const color = member?.color ?? "#8C8279"
  const emoji = member?.avatar_emoji
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
