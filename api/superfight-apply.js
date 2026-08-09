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
import { setCompetitorWeightPreferences } from "../src/server/weight-preferences.js";
import {
  belt,
  competitorAge,
  genderDivision,
  grapplingPreference,
  optionalText,
  resolvePreferredContact,
  requiredText,
  uuid,
  uuidList,
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
    const weightOptionIds = uuidList(body.weightOptionIds, "Acceptable weight classes");
    const fullName = requiredText(body.fullName, "Full name", 160);
    const phone = optionalText(body.phone, "Cell Phone", 50);
    const age = competitorAge(body.age);
    const division = genderDivision(body.genderDivision);
    const preference = grapplingPreference(body.grapplingPreference);
    const applicantBelt = belt(body.belt);
    const gym = requiredText(body.gym, "Gym / academy", 160);
    const instagramInput = optionalText(body.instagram, "Instagram", 300);
    let instagram;

    try {
      instagram = normalizeInstagram(instagramInput);
    } catch (error) {
      throw new HttpError(400, error.message, "invalid_application");
    }
    const preferredContact = resolvePreferredContact({
      phone,
      instagramHandle: instagram.handle,
      requestedMethod: body.preferredContactMethod,
    });

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

    const { data: competitor, error: insertError } = await service
      .from("superfight_competitors")
      .insert({
        event_id: eventId,
        source: "public_application",
        full_name: fullName,
        phone,
        preferred_contact_method: preferredContact,
        age,
        gender_division: division,
        grappling_preference: preference,
        belt: applicantBelt,
        gym,
        instagram_handle: instagram.handle,
        instagram_url: instagram.url,
        application_submitted_at: new Date().toISOString(),
      })
      .select("id, status_slug")
      .single();

    if (insertError) {
      throw databaseFailure(insertError, "application insert failed");
    }

    try {
      await setCompetitorWeightPreferences(service, {
        competitorId: competitor.id,
        eventId,
        weightOptionIds,
      });
    } catch (error) {
      await service.from("superfight_competitors").delete().eq("id", competitor.id);
      throw error;
    }

    sendJson(response, 201, {
      received: true,
      statusPath: `/status/${competitor.status_slug}`,
    });
  });
}
