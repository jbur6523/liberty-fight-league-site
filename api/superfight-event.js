import {
  HttpError,
  allowMethods,
  databaseFailure,
  handleApi,
  queryValue,
  sendJson,
} from "../src/server/http.js";
import { getServiceSupabase } from "../src/server/supabase.js";

export default async function handler(request, response) {
  return handleApi(request, response, async () => {
    allowMethods(request, response, ["GET"]);
    const service = getServiceSupabase();
    const requestedSlug = queryValue(request, "event")?.trim();
    let eventQuery = service
      .from("superfight_events")
      .select("id, public_slug, name, starts_at, venue, application_info, applications_open, instagram_url");

    if (requestedSlug) {
      eventQuery = eventQuery.eq("public_slug", requestedSlug).limit(1);
    } else {
      eventQuery = eventQuery
        .eq("applications_open", true)
        .order("starts_at", { ascending: true, nullsFirst: false })
        .limit(1);
    }

    const { data: events, error: eventError } = await eventQuery;
    if (eventError) {
      throw databaseFailure(eventError, "public event lookup failed");
    }

    const event = events?.[0];
    if (!event) {
      throw new HttpError(404, "No Superfight event is available yet.", "event_not_found");
    }

    const { data: weightOptions, error: weightError } = await service
      .from("superfight_event_weight_options")
      .select("id, label, value_lbs, sort_order")
      .eq("event_id", event.id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("value_lbs", { ascending: true });

    if (weightError) {
      throw databaseFailure(weightError, "public weight option lookup failed");
    }

    sendJson(response, 200, {
      event: {
        id: event.id,
        slug: event.public_slug,
        name: event.name,
        startsAt: event.starts_at,
        venue: event.venue,
        applicationInfo: event.application_info,
        applicationsOpen: event.applications_open,
        instagramUrl: event.instagram_url,
        weightOptions: weightOptions.map((option) => ({
          id: option.id,
          label: option.label,
          valueLbs: Number(option.value_lbs),
        })),
      },
    });
  });
}
