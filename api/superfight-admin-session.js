import {
  HttpError,
  allowMethods,
  assertSameOrigin,
  handleApi,
  readJsonBody,
  sendJson,
} from "../src/server/http.js";
import {
  clearAdminSessionCookies,
  requireSuperfightAdmin,
  signInSuperfightAdmin,
} from "../src/server/admin-auth.js";
import { email, requiredText } from "../src/superfight/validation.js";

export default async function handler(request, response) {
  return handleApi(request, response, async () => {
    allowMethods(request, response, ["GET", "POST", "DELETE"]);

    if (request.method === "POST") {
      assertSameOrigin(request);
      const body = await readJsonBody(request);
      const user = await signInSuperfightAdmin(
        request,
        response,
        email(body.email),
        requiredText(body.password, "Password", 500),
      );
      sendJson(response, 200, { signedIn: true, email: user.email });
      return;
    }

    if (request.method === "DELETE") {
      assertSameOrigin(request);
      clearAdminSessionCookies(request, response);
      sendJson(response, 200, { signedIn: false });
      return;
    }

    const user = await requireSuperfightAdmin(request, response);
    if (!user.email) {
      throw new HttpError(500, "Promoter account is missing an email.", "invalid_admin_account");
    }
    sendJson(response, 200, { signedIn: true, email: user.email });
  });
}
