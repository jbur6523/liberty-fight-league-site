import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { HttpError, databaseFailure } from "./http.js";
import { PHOTO_BUCKET, photoUrl } from "./fan-picks.js";

export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

export async function validatedPhoto(body) {
  if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(body.type)) {
    throw new HttpError(400, "Choose a JPEG, PNG, or WebP image.", "invalid_image");
  }
  if (typeof body.image !== "string" || body.image.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4) {
    throw new HttpError(413, "Choose an image smaller than 3 MB.", "image_too_large");
  }
  if (body.image.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.image)) {
    throw new HttpError(400, "The image could not be read.", "invalid_image");
  }
  const buffer = Buffer.from(body.image, "base64");
  if (!buffer.length || buffer.length > MAX_PHOTO_BYTES) throw new HttpError(413, "Choose an image smaller than 3 MB.", "image_too_large");
  try {
    const input = sharp(buffer, { limitInputPixels: 24_000_000, failOn: "warning" });
    const metadata = await input.metadata();
    if (!new Set(["jpeg", "png", "webp"]).has(metadata.format) || (metadata.pages || 1) !== 1) throw new Error("Unsupported image");
    // Decode, auto-orient, strip metadata and re-encode; never publish the original upload.
    return await input.rotate().resize(800, 1000, { fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  } catch {
    throw new HttpError(400, "Choose a valid, non-animated JPEG, PNG, or WebP image under 24 megapixels.", "invalid_image");
  }
}

export async function saveFighterPhoto(service, competitorId, body, remove = false) {
  const { data: fighter, error } = await service.from("superfight_competitors")
    .select("id,fan_photo_path").eq("id", competitorId).maybeSingle();
  if (error) throw databaseFailure(error, "fighter photo lookup failed");
  if (!fighter) throw new HttpError(404, "Competitor could not be found.", "competitor_not_found");
  const bucket = service.storage.from(PHOTO_BUCKET);
  const path = remove ? null : `${competitorId}/${randomUUID()}.webp`;
  if (path) {
    const image = await validatedPhoto(body);
    const { error: uploadError } = await bucket.upload(path, image, { contentType: "image/webp", upsert: false, cacheControl: "31536000" });
    if (uploadError) throw databaseFailure(uploadError, "fighter photo upload failed");
  }
  // Compare-and-swap prevents a concurrent replacement/removal deleting the winning image.
  let query = service.from("superfight_competitors").update({ fan_photo_path: path }).eq("id", competitorId);
  query = fighter.fan_photo_path ? query.eq("fan_photo_path", fighter.fan_photo_path) : query.is("fan_photo_path", null);
  const { data: updated, error: updateError } = await query.select("id").maybeSingle();
  if (updateError || !updated) {
    // An error may mean the write committed but its response was lost. Keep the
    // object on uncertain failures; deleting it could break the saved reference.
    if (updateError) throw databaseFailure(updateError, "fighter photo save failed");
    if (path) await bucket.remove([path]);
    throw new HttpError(409, "This image changed in another window. Refresh and try again.", "photo_conflict");
  }
  if (fighter.fan_photo_path) {
    const { error: cleanupError } = await bucket.remove([fighter.fan_photo_path]);
    if (cleanupError) console.error("[fan-picks] old image cleanup failed", cleanupError);
  }
  return { competitorId, photoUrl: photoUrl(service, path) };
}
