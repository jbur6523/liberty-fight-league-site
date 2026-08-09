import { HttpError, databaseFailure } from "./http.js";
import { createAuthSupabase, getServiceSupabase } from "./supabase.js";

const ACCESS_COOKIE = "lfl_superfight_access";
const REFRESH_COOKIE = "lfl_superfight_refresh";

function parseCookies(request) {
  const cookies = new Map();
  const header = request.headers.cookie;

  if (!header) {
    return cookies;
  }

  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) {
      continue;
    }

    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    cookies.set(name, decodeURIComponent(value));
  }

  return cookies;
}

function usesSecureCookies(request) {
  const forwardedProtocol = request.headers["x-forwarded-proto"];
  return process.env.VERCEL === "1" || forwardedProtocol === "https";
}

function sessionCookie(name, value, maximumAge, secure) {
  const segments = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maximumAge))}`,
  ];

  if (secure) {
    segments.push("Secure");
  }

  return segments.join("; ");
}

export function setAdminSessionCookies(request, response, session) {
  const secure = usesSecureCookies(request);
  response.setHeader("Set-Cookie", [
    sessionCookie(ACCESS_COOKIE, session.access_token, session.expires_in ?? 3600, secure),
    sessionCookie(REFRESH_COOKIE, session.refresh_token, 60 * 60 * 24 * 30, secure),
  ]);
}

export function clearAdminSessionCookies(request, response) {
  const secure = usesSecureCookies(request);
  response.setHeader("Set-Cookie", [
    sessionCookie(ACCESS_COOKIE, "", 0, secure),
    sessionCookie(REFRESH_COOKIE, "", 0, secure),
  ]);
}

async function authorizedAdmin(user) {
  const service = getServiceSupabase();
  const { data, error } = await service.rpc("is_superfight_admin", {
    check_user_id: user.id,
  });

  if (error) {
    throw databaseFailure(error, "admin membership lookup failed");
  }

  return data === true;
}

export async function requireSuperfightAdmin(request, response) {
  const cookies = parseCookies(request);
  const accessToken = cookies.get(ACCESS_COOKIE);
  const refreshToken = cookies.get(REFRESH_COOKIE);
  const service = getServiceSupabase();
  let user;

  if (accessToken) {
    const result = await service.auth.getUser(accessToken);
    user = result.data.user;
  }

  if (!user && refreshToken) {
    const auth = createAuthSupabase();
    const { data, error } = await auth.auth.refreshSession({ refresh_token: refreshToken });

    if (!error && data.session && data.user) {
      user = data.user;
      setAdminSessionCookies(request, response, data.session);
    }
  }

  if (!user) {
    clearAdminSessionCookies(request, response);
    throw new HttpError(401, "Promoter sign-in required.", "admin_sign_in_required");
  }

  if (!(await authorizedAdmin(user))) {
    clearAdminSessionCookies(request, response);
    throw new HttpError(403, "This account is not authorized for promoter tools.", "admin_forbidden");
  }

  return user;
}

export async function signInSuperfightAdmin(request, response, email, password) {
  const auth = createAuthSupabase();
  const { data, error } = await auth.auth.signInWithPassword({ email, password });

  if (error || !data.user || !data.session) {
    throw new HttpError(401, "Email or password was not recognized.", "invalid_credentials");
  }

  if (!(await authorizedAdmin(data.user))) {
    await auth.auth.signOut().catch(() => {});
    throw new HttpError(403, "This account is not authorized for promoter tools.", "admin_forbidden");
  }

  setAdminSessionCookies(request, response, data.session);
  return data.user;
}
