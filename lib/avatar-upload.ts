import type { SupabaseClient } from "@supabase/supabase-js"

const SIZE = 320 // px, square

/** Crops the image to a centred square, scales it to 320×320 and returns a JPEG. */
async function toSquareJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - side) / 2
  const sy = (bitmap.height - side) / 2
  const canvas = document.createElement("canvas")
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas not supported")
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, SIZE, SIZE)
  bitmap.close?.()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not process image"))), "image/jpeg", 0.85),
  )
}

/** Resizes and uploads a member photo, returning its public URL. */
export async function uploadMemberPhoto(supabase: SupabaseClient, file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file")
  const blob = await toSquareJpeg(file)
  const path = `members/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from("avatars").upload(path, blob, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
    upsert: false,
  })
  if (error) throw new Error(error.message)
  return supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl
}
