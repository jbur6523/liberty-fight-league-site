import { requireSuperfightAdmin } from "../src/server/admin-auth.js";
import { allowMethods, assertSameOrigin, handleApi, queryValue, readJsonBody, sendJson } from "../src/server/http.js";
import { getServiceSupabase } from "../src/server/supabase.js";
import { createProfileShare, getProfileShare } from "../src/server/profile-shares.js";
import { uuid } from "../src/superfight/validation.js";

export default async function handler(request, response) {
  return handleApi(request, response, async () => {
    allowMethods(request, response, ["GET", "POST"]);
    if (request.method === "POST") {
      assertSameOrigin(request);
      await requireSuperfightAdmin(request, response);
      const body = await readJsonBody(request);
      const competitorId = uuid(body.competitorId, "Competitor");
      sendJson(response, 201, await createProfileShare(getServiceSupabase(), competitorId));
    } else {
      sendJson(response, 200, { profile: await getProfileShare(getServiceSupabase(), queryValue(request, "token")) });
    }
  });
}
