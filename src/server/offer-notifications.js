export function offerEmail(offer, target, fighter) {
  return {
    subject: `LFL match offer: ${fighter.full_name} → ${target.full_name}`.replace(/[\r\n]/g, " "),
    text: [
      `Offer for: ${target.full_name}`,
      `Submitted by: ${fighter.full_name}`,
      `Instagram: @${fighter.instagram_handle}`,
      `Weight: ${offer.offered_weight_lbs ?? fighter.competition_weight_lbs ?? "Not entered"} lb`,
      `Belt / experience: ${fighter.belt ?? fighter.experience_level ?? "Not entered"}`,
      `Gym: ${fighter.gym ?? "Not entered"}`,
      `Match type: ${offer.bout_type === "gi" ? "Gi" : "No-Gi"}`,
      "", "Review in Offers: https://www.libertyfightleague.com/admin/superfights",
      "Instagram handles on public offers are self-reported; confirm details before making the match.",
    ].join("\n"),
  };
}

export async function notifyOffer(service, offerId, fetcher = fetch) {
  let attempts = 0;
  try {
    const { data: offer, error } = await service.from("superfight_offers").select("*").eq("id", offerId).single();
    if (error) throw error;
    if (offer.notification_state === "sent") return true;
    attempts = offer.notification_attempts + 1;
    if (!process.env.RESEND_API_KEY || !process.env.SUPERFIGHT_NOTIFY_FROM) throw new Error("Offer email sender is not configured");
    const { data: fighters, error: fighterError } = await service.from("superfight_competitors")
      .select("id,full_name,instagram_handle,competition_weight_lbs,belt,experience_level,gym")
      .in("id", [offer.target_competitor_id, offer.offering_competitor_id]);
    if (fighterError) throw fighterError;
    const { data: admins, error: adminError } = await service.from("superfight_admin_users").select("promoter_id");
    if (adminError) throw adminError;
    const { data: promoters, error: promoterError } = await service.from("promoters").select("email")
      .in("id", [...new Set(admins.map((admin) => admin.promoter_id))]);
    if (promoterError) throw promoterError;
    const recipients = [...new Set(promoters.map((promoter) => promoter.email.toLowerCase()))];
    if (!recipients.length) throw new Error("No promoter email configured");
    const message = offerEmail(offer, fighters.find((fighter) => fighter.id === offer.target_competitor_id), fighters.find((fighter) => fighter.id === offer.offering_competitor_id));
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `superfight-offer-${offer.id}` },
      body: JSON.stringify({ from: process.env.SUPERFIGHT_NOTIFY_FROM, to: recipients, ...message }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Offer email provider returned ${response.status}`);
    const { error: updateError } = await service.from("superfight_offers").update({ notification_state: "sent", notification_attempts: attempts, notification_sent_at: new Date().toISOString() }).eq("id", offer.id);
    if (updateError) throw updateError;
    return true;
  } catch (error) {
    console.error("[superfight] Offer notification pending", error.message);
    await service.from("superfight_offers").update({ notification_state: "failed", notification_attempts: attempts }).eq("id", offerId).neq("notification_state", "sent");
    return false;
  }
}
