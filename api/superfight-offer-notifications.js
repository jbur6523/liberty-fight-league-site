import { timingSafeEqual } from "node:crypto";
import { allowMethods, databaseFailure, handleApi, HttpError, sendJson } from "../src/server/http.js";
import { getServiceSupabase } from "../src/server/supabase.js";
import { notifyOffer } from "../src/server/offer-notifications.js";

export const config = { maxDuration: 60 };

export default async function handler(request, response) {
  return handleApi(request, response, async () => {
    allowMethods(request, response, ["GET"]);
    const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET || ""}`);
    const actual = Buffer.from(String(request.headers.authorization || ""));
    if (!process.env.CRON_SECRET || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new HttpError(401, "Authorization required.", "unauthorized");
    }
    if (!process.env.RESEND_API_KEY || !process.env.SUPERFIGHT_NOTIFY_FROM) {
      throw new HttpError(503, "Offer email sender is not configured.", "email_not_configured");
    }
    const service = getServiceSupabase();
    const { data, error } = await service.from("superfight_offers").select("id")
      .eq("state", "pending").neq("notification_state", "sent").lt("notification_attempts", 12)
      .order("created_at", { ascending: true }).limit(5);
    if (error) throw databaseFailure(error, "offer notification retry lookup failed");
    let sent = 0;
    for (const offer of data) if (await notifyOffer(service, offer.id)) sent++;
    sendJson(response, 200, { attempted: data.length, sent });
  });
}
