import { requireSuperfightAdmin } from "../src/server/admin-auth.js";
import { allowMethods, assertSameOrigin, handleApi, readJsonBody, sendJson } from "../src/server/http.js";
import { getServiceSupabase } from "../src/server/supabase.js";
import { saveFighterPhoto, MAX_PHOTO_BYTES } from "../src/server/fighter-photos.js";
import { uuid } from "../src/superfight/validation.js";

export default async function handler(request, response) {
  return handleApi(request, response, async () => {
    allowMethods(request, response, ["POST", "DELETE"]);
    await requireSuperfightAdmin(request, response);
    assertSameOrigin(request);
    const body = await readJsonBody(request, Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 2048);
    sendJson(response, 200, await saveFighterPhoto(getServiceSupabase(), uuid(body.competitorId, "Competitor"), body, request.method === "DELETE"));
  });
}
