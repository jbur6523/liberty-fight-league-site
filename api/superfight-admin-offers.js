import { requireSuperfightAdmin } from "../src/server/admin-auth.js";
import { allowMethods, assertSameOrigin, databaseFailure, handleApi, HttpError, queryValue, readJsonBody, sendJson } from "../src/server/http.js";
import { getServiceSupabase } from "../src/server/supabase.js";
import { adminOffers } from "../src/server/offers.js";
import { notifyOffer } from "../src/server/offer-notifications.js";
import { uuid } from "../src/superfight/validation.js";

export default async function handler(request, response) {
  return handleApi(request, response, async () => {
    allowMethods(request, response, ["GET", "POST"]);
    await requireSuperfightAdmin(request, response);
    const service = getServiceSupabase();
    if (request.method === "GET") {
      sendJson(response, 200, { offers: await adminOffers(service, uuid(queryValue(request, "eventId"), "Event")) });
      return;
    }
    assertSameOrigin(request);
    const body = await readJsonBody(request);
    const offerId = uuid(body.offerId, "Offer");
    if (body.action === "retry_notification") {
      const sent = await notifyOffer(service, offerId);
      if (!sent) throw new HttpError(503, "Email could not be sent. The offer is saved; check the email configuration and retry.", "email_pending");
      sendJson(response, 200, { sent: true });
      return;
    }
    if (body.action !== "deny") throw new HttpError(400, "Choose a valid offer action.", "invalid_offer");
    const { data, error } = await service.from("superfight_offers").update({ state: "denied", resolved_at: new Date().toISOString() })
      .eq("id", offerId).eq("state", "pending").select("id").maybeSingle();
    if (error) throw databaseFailure(error, "offer denial failed");
    if (!data) throw new HttpError(409, "This offer has already been resolved.", "offer_conflict");
    sendJson(response, 200, { denied: true });
  });
}
