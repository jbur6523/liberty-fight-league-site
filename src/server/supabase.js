import { createClient } from "@supabase/supabase-js";

import { HttpError } from "./http.js";

let serviceClient;

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`[superfight] Missing required server environment variable: ${name}`);
    throw new HttpError(503, "The Superfight system is not configured yet.", "not_configured");
  }
  return value;
}

function clientOptions() {
  return {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  };
}

export function getServiceSupabase() {
  if (!serviceClient) {
    serviceClient = createClient(
      requiredEnvironment("SUPABASE_URL"),
      requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
      clientOptions(),
    );
  }

  return serviceClient;
}

export function createAuthSupabase() {
  return createClient(
    requiredEnvironment("SUPABASE_URL"),
    requiredEnvironment("SUPABASE_ANON_KEY"),
    clientOptions(),
  );
}
