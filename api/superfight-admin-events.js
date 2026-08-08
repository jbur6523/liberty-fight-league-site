import { requireSuperfightAdmin } from "../src/server/admin-auth.js";
import {
  HttpError,
  allowMethods,
  assertSameOrigin,
  databaseFailure,
  handleApi,
  readJsonBody,
  sendJson,
} from "../src/server/http.js";
import { getServiceSupabase } from "../src/server/supabase.js";
import {
  optionalText,
  positiveWeight,
  requiredText,
  uuid,
} from "../src/superfight/validation.js";

function publicSlug(value) {
  const slug = requiredText(value, "Event URL slug", 80).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new HttpError(400, "Use lowercase letters, numbers, and single hyphens for the event URL slug.", "invalid_event");
  }
  return slug;
}

function optionalDateTime(value) {
  const text = optionalText(value, "Event date and time", 100);
  if (!text) {
    return null;
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, "Enter a valid event date and time.", "invalid_event");
  }
  return date.toISOString();
}

function optionalUrl(value) {
  const text = optionalText(value, "Instagram URL", 500);
  if (!text) {
    return null;
  }

  try {
    const url = new URL(text);
    if (!new Set(["http:", "https:"]).has(url.protocol)) {
      throw new Error("unsupported protocol");
    }
    return url.toString();
  } catch {
    throw new HttpError(400, "Enter a valid Instagram URL.", "invalid_event");
  }
}

async function listEvents(service) {
  const [{ data: events, error: eventError }, { data: weights, error: weightError }] = await Promise.all([
    service
      .from("superfight_events")
      .select("id, public_slug, name, starts_at, venue, application_info, applications_open, instagram_url, created_at")
      .order("starts_at", { ascending: true, nullsFirst: false }),
    service
      .from("superfight_event_weight_options")
      .select("id, event_id, label, value_lbs, sort_order, is_active")
      .order("sort_order", { ascending: true })
      .order("value_lbs", { ascending: true }),
  ]);

  if (eventError || weightError) {
    throw databaseFailure(eventError || weightError, "admin event list failed");
  }

  return events.map((event) => ({
    id: event.id,
    slug: event.public_slug,
    name: event.name,
    startsAt: event.starts_at,
    venue: event.venue,
    applicationInfo: event.application_info,
    applicationsOpen: event.applications_open,
    instagramUrl: event.instagram_url,
    createdAt: event.created_at,
    weightOptions: weights
      .filter((weight) => weight.event_id === event.id)
      .map((weight) => ({
        id: weight.id,
        label: weight.label,
        valueLbs: Number(weight.value_lbs),
        sortOrder: weight.sort_order,
        active: weight.is_active,
      })),
  }));
}

export default async function handler(request, response) {
  return handleApi(request, response, async () => {
    allowMethods(request, response, ["GET", "POST", "PATCH"]);
    await requireSuperfightAdmin(request, response);
    const service = getServiceSupabase();

    if (request.method === "GET") {
      sendJson(response, 200, { events: await listEvents(service) });
      return;
    }

    assertSameOrigin(request);
    const body = await readJsonBody(request);
    const resource = body.resource ?? "event";

    if (resource === "weightOption") {
      const values = {
        label: requiredText(body.label, "Weight label", 80),
        value_lbs: positiveWeight(body.valueLbs),
        sort_order: Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
        is_active: body.active === undefined ? true : Boolean(body.active),
      };
      let query;

      if (request.method === "POST") {
        query = service
          .from("superfight_event_weight_options")
          .insert({ ...values, event_id: uuid(body.eventId, "Event") });
      } else {
        query = service
          .from("superfight_event_weight_options")
          .update(values)
          .eq("id", uuid(body.weightOptionId, "Weight option"));
      }

      const { error } = await query;
      if (error) {
        throw databaseFailure(error, "admin weight option write failed");
      }
      sendJson(response, 200, { events: await listEvents(service) });
      return;
    }

    if (request.method === "POST") {
      const { error } = await service.from("superfight_events").insert({
        public_slug: publicSlug(body.slug),
        name: requiredText(body.name, "Event name", 160),
        starts_at: optionalDateTime(body.startsAt),
        venue: optionalText(body.venue, "Venue", 500),
        application_info: optionalText(body.applicationInfo, "Event information", 5_000),
        applications_open: Boolean(body.applicationsOpen),
        instagram_url: optionalUrl(body.instagramUrl),
      });

      if (error) {
        throw databaseFailure(error, "admin event create failed");
      }
    } else {
      const eventId = uuid(body.eventId, "Event");
      const updates = {};
      if (Object.hasOwn(body, "slug")) updates.public_slug = publicSlug(body.slug);
      if (Object.hasOwn(body, "name")) updates.name = requiredText(body.name, "Event name", 160);
      if (Object.hasOwn(body, "startsAt")) updates.starts_at = optionalDateTime(body.startsAt);
      if (Object.hasOwn(body, "venue")) updates.venue = optionalText(body.venue, "Venue", 500);
      if (Object.hasOwn(body, "applicationInfo")) {
        updates.application_info = optionalText(body.applicationInfo, "Event information", 5_000);
      }
      if (Object.hasOwn(body, "applicationsOpen")) {
        updates.applications_open = Boolean(body.applicationsOpen);
      }
      if (Object.hasOwn(body, "instagramUrl")) updates.instagram_url = optionalUrl(body.instagramUrl);
      if (Object.keys(updates).length === 0) {
        throw new HttpError(400, "No event changes were supplied.", "invalid_event");
      }

      const { error } = await service
        .from("superfight_events")
        .update(updates)
        .eq("id", eventId);
      if (error) {
        throw databaseFailure(error, "admin event update failed");
      }
    }

    sendJson(response, 200, { events: await listEvents(service) });
  });
}
