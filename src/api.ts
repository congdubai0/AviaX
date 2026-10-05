import { ApiError, invokeApi } from "./lib/api";
export { ApiError };

type ApiBody = Record<string, unknown>;

function parseBody(options: RequestInit): ApiBody {
  if (!options.body) return {};
  if (typeof options.body !== "string") {
    throw new ApiError("Format permintaan tidak valid.", 400, "INVALID_BODY");
  }
  try {
    const parsed: unknown = JSON.parse(options.body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Expected an object.");
    }
    return parsed as ApiBody;
  } catch {
    throw new ApiError("Format permintaan tidak valid.", 400, "INVALID_BODY");
  }
}

function routeRequest(path: string, options: RequestInit): { name: string; body: ApiBody } {
  const url = new URL(path, window.location.origin);
  const pathname = url.pathname.replace(/^\/api\/?/, "");
  const body = parseBody(options);

  if (pathname === "bootstrap") return { name: "auth", body: { action: "bootstrap" } };
  if (pathname === "age-confirm") return { name: "auth", body: { ...body, action: "accept_terms" } };
  if (pathname === "missions" && options.method !== "POST") return { name: "missions", body: {} };
  if (pathname === "flight") {
    return { name: "daily-flight", body: { action: options.method === "POST" ? "fly" : "status" } };
  }
  if (pathname === "leaderboard") return { name: "leaderboard", body: {} };
  if (pathname === "referrals") {
    return { name: "referral", body: { action: "list", offset: Number(url.searchParams.get("offset") ?? "0") } };
  }

  const missionMatch = pathname.match(/^missions\/([^/]+)\/(start|verify)$/);
  if (missionMatch) {
    return {
      name: missionMatch[2] === "start"
        ? "mission-start"
        : missionMatch[1] === "join_channel" ? "check-channel" : "mission-complete",
      body: { ...body, code: decodeURIComponent(missionMatch[1]) },
    };
  }
  if (pathname === "admin/metrics") return { name: "admin", body: { action: "metrics" } };
  if (pathname === "admin/settings") return { name: "admin", body: { ...body, action: "save_settings" } };
  if (pathname === "admin/export.csv") return { name: "admin", body: { action: "export_csv" } };
  const userMatch = pathname.match(/^admin\/users\/([^/]+)$/);
  if (userMatch) return { name: "admin", body: { ...body, action: "update_user", telegramId: userMatch[1] } };
  const missionAdminMatch = pathname.match(/^admin\/missions\/([^/]+)$/);
  if (missionAdminMatch) {
    return { name: "admin", body: { ...body, action: "update_mission", missionId: missionAdminMatch[1] } };
  }

  throw new ApiError("Permintaan tidak dikenal.", 404, "UNKNOWN_ENDPOINT");
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const route = routeRequest(path, options);
  return invokeApi<T>(route.name, route.body);
}

export async function adminRequest<T>(
  path: string,
  _unusedClientSecret: string,
  options: RequestInit = {},
): Promise<T> {
  const route = routeRequest(path, options);
  return invokeApi<T>(route.name, route.body);
}
