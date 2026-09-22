import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function readNamedKey(name: "SUPABASE_PUBLISHABLE_KEYS" | "SUPABASE_SECRET_KEYS") {
  const raw = Deno.env.get(name);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return parsed.default || Object.values(parsed)[0] || "";
  } catch {
    return "";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Authentication required." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const publishableKey = readNamedKey("SUPABASE_PUBLISHABLE_KEYS") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  const secretKey = readNamedKey("SUPABASE_SECRET_KEYS") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !publishableKey || !secretKey) return json({ error: "Service unavailable." }, 503);

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  const caller = userData?.user;
  if (userError || !caller) return json({ error: "Authentication required." }, 401);

  const body = await req.json().catch(() => ({}));
  const groupId = String(body.group_id || "").trim();
  const institutionId = String(body.institution_id || "").trim();

  if (!groupId || !/^\d{2}-\d{5}$/.test(institutionId)) {
    return json({ error: "Invalid group or student ID." }, 400);
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: group } = await admin
    .from("groups")
    .select("id,created_by")
    .eq("id", groupId)
    .maybeSingle();

  const { data: membership } = await admin
    .from("group_members")
    .select("role")
    .eq("group_id", groupId)
    .eq("user_id", caller.id)
    .maybeSingle();

  const isAdmin = group?.created_by === caller.id || membership?.role === "admin";
  if (!isAdmin) return json({ error: "Only a group administrator can invite members." }, 403);

  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("id,institution_id,display_name,role")
    .eq("institution_id", institutionId)
    .eq("role", "student")
    .maybeSingle();

  if (targetError || !target?.id) return json({ error: "Student not found." }, 404);

  const { error: insertError } = await admin
    .from("group_members")
    .upsert({
      group_id: groupId,
      user_id: target.id,
      institution_id: target.institution_id,
      role: "member"
    }, { onConflict: "group_id,user_id" });

  if (insertError) return json({ error: "Unable to invite member." }, 500);

  return json({
    user_id: target.id,
    institution_id: target.institution_id,
    display_name: target.display_name
  });
});
