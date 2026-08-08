import { normalizeInstagram } from "../src/superfight/domain.js";
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
  belt,
  email,
  optionalText,
  requiredText,
  uuid,
} from "../src/superfight/validation.js";

export default async function handler(request, response) {
  return handleApi(request, response, async () => {
    allowMethods(request, response, ["POST"]);
    assertSameOrigin(request);
    const body = await readJsonBody(request);

    if (optionalText(body.website, "Website", 200)) {
      sendJson(response, 201, { received: true });
      return;
    }

    const eventId = uuid(body.eventId, "Event");
    const weightOptionId = uuid(body.weightOptionId, "Competition weight");
    const fullName = requiredText(body.fullName, "Full name", 160);
    const phone = requiredText(body.phone, "Phone", 50);
    const applicantEmail = email(body.email);
    const applicantBelt = belt(body.belt);
    const gym = requiredText(body.gym, "Gym / academy", 160);
    const instagramInput = optionalText(body.instagram, "Instagram", 300);
    let instagram;

    try {
      instagram = normalizeInstagram(instagramInput);
    } catch (error) {
      throw new HttpError(400, error.message, "invalid_application");
    }

    const service = getServiceSupabase();
    const { data: event, error: eventError } = await service
      .from("superfight_events")
      .select("id, applications_open")
      .eq("id", eventId)
      .maybeSingle();

    if (eventError) {
      throw databaseFailure(eventError, "application event validation failed");
    }
    if (!event) {
      throw new HttpError(404, "This event could not be found.", "event_not_found");
    }
    if (!event.applications_open) {
      throw new HttpError(409, "Applications are closed for this event.", "applications_closed");
    }

    const { data: weightOption, error: weightError } = await service
      .from("superfight_event_weight_options")
      .select("id, value_lbs")
      .eq("id", weightOptionId)
      .eq("event_id", eventId)
      .eq("is_active", true)
      .maybeSingle();

    if (weightError) {
      throw databaseFailure(weightError, "application weight validation failed");
    }
    if (!weightOption) {
      throw new HttpError(400, "Select an available competition weight.", "invalid_application");
    }

    const { data: competitor, error: insertError } = await service
      .from("superfight_competitors")
      .insert({
        event_id: eventId,
        source: "public_application",
        full_name: fullName,
        phone,
        email: applicantEmail,
        belt: applicantBelt,
        competition_weight_lbs: Number(weightOption.value_lbs),
        weight_option_id: weightOption.id,
        gym,
        instagram_handle: instagram.handle,
        instagram_url: instagram.url,
        application_submitted_at: new Date().toISOString(),
      })
      .select("status_token")
      .single();

    if (insertError) {
      throw databaseFailure(insertError, "application insert failed");
    }

    sendJson(response, 201, {
      received: true,
      statusPath: `/status/${competitor.status_token}`,
    });
  });
}
