import { getAdminClient } from "./supabase.ts";

export type MissionRecord = {
  code: string;
  title_id: string;
  points: number;
  kind: string;
  requires: string | null;
  sort_order: number;
  config: Record<string, unknown>;
};

export async function getMission(code: string): Promise<MissionRecord | null> {
  const { data, error } = await getAdminClient()
    .from("missions")
    .select("code,title_id,points,kind,requires,sort_order,config")
    .eq("code", code)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(`Mission lookup failed: ${error.message}`);
  return data as MissionRecord | null;
}

export async function completeMission(userId: string, code: string): Promise<{
  awarded: boolean;
  points: number;
  status: "done";
}> {
  const { data, error } = await getAdminClient().rpc("complete_user_mission", {
    p_user_id: userId,
    p_mission_code: code,
    p_ref_id: `${code}:v1`,
  });
  if (error) throw new Error(error.message);
  return data as { awarded: boolean; points: number; status: "done" };
}

export async function configuredValue<T>(key: string, fallback: T): Promise<T> {
  const { data, error } = await getAdminClient()
    .from("settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(`Setting "${key}" lookup failed: ${error.message}`);
  if (!data) return fallback;
  const value: unknown = data.value;
  if (value && typeof value === "object" && "value" in value) {
    return (value as { value: T }).value;
  }
  return value as T;
}
