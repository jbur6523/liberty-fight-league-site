export class HttpError extends Error {
  constructor(statusCode, message, code = "request_error") {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
export function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

export function allowMethods(request, response, methods) {
  if (!methods.includes(request.method)) {
    response.setHeader("Allow", methods.join(", "));
    throw new HttpError(405, "Method not allowed.", "method_not_allowed");
  }
}

export function queryValue(request, name) {
  const value = request.query?.[name];
  return Array.isArray(value) ? value[0] : value;
}

export async function readJsonBody(request, maximumBytes = 32_000) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
    return request.body;
  }

  if (typeof request.body === "string") {
    if (Buffer.byteLength(request.body, "utf8") > maximumBytes) {
      throw new HttpError(413, "Request body is too large.", "body_too_large");
    }

    try {
      return JSON.parse(request.body);
    } catch {
      throw new HttpError(400, "Request body must be valid JSON.", "invalid_json");
    }
  }

  const chunks = [];
  let byteLength = 0;

  for await (const chunk of request) {
    byteLength += chunk.length;
    if (byteLength > maximumBytes) {
      throw new HttpError(413, "Request body is too large.", "body_too_large");
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.", "invalid_json");
  }
}

export function assertSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) {
    return;
  }

  const forwardedHost = request.headers["x-forwarded-host"];
  const host = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost || request.headers.host;

  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "Invalid request origin.", "invalid_origin");
  }

  if (!host || originHost.toLowerCase() !== String(host).toLowerCase()) {
    throw new HttpError(403, "Cross-site request rejected.", "cross_site_request");
  }
}

export function databaseFailure(error, context) {
  console.error(`[superfight] ${context}`, error);
  return new HttpError(500, "The request could not be completed.", "database_error");
}

export async function handleApi(request, response, handler) {
  try {
    await handler();
  } catch (error) {
    if (response.writableEnded) {
      return;
    }

    if (error instanceof HttpError) {
      sendJson(response, error.statusCode, {
        error: error.code,
        message: error.message,
      });
      return;
    }

    console.error("[superfight] Unhandled API error", error);
    sendJson(response, 500, {
      error: "internal_error",
      message: "The request could not be completed.",
    });
  }
}
