import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
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

function strongPassword(password: string) {
  return password.length >= 12
    && password.length <= 128
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed." }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return response({ error: "Authentication required." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const publishableKey = readNamedKey("SUPABASE_PUBLISHABLE_KEYS") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  const secretKey = readNamedKey("SUPABASE_SECRET_KEYS") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !publishableKey || !secretKey) {
    return response({ error: "Security service unavailable." }, 503);
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  const caller = userData?.user;
  if (userError || !caller) return response({ error: "Authentication required." }, 401);

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: callerProfile, error: callerProfileError } = await admin
    .from("profiles")
    .select("id,institution_id,role,is_admin,must_change_password")
    .eq("id", caller.id)
    .maybeSingle();

  if (callerProfileError || !callerProfile) {
    return response({ error: "Account profile is unavailable." }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "status");

  if (action === "status") {
    return response({
      is_admin: Boolean(callerProfile.is_admin),
      must_change_password: Boolean(callerProfile.must_change_password)
    });
  }

  if (action === "mark_changed") {
    const changedAt = new Date().toISOString();
    const { error: updateError } = await admin
      .from("profiles")
      .update({
        must_change_password: false,
        password_changed_at: changedAt
      })
      .eq("id", caller.id);

    if (updateError) return response({ error: "Unable to update password state." }, 500);

    await admin.from("password_reset_audit").insert({
      admin_user_id: null,
      admin_institution_id: null,
      target_user_id: caller.id,
      target_institution_id: callerProfile.institution_id,
      target_role: callerProfile.role,
      event: "user_changed"
    });

    return response({ success: true, must_change_password: false });
  }

  if (action !== "admin_reset") return response({ error: "Invalid action." }, 400);
  if (!callerProfile.is_admin) return response({ error: "Administrator permission required." }, 403);

  const targetInstitutionId = String(body.target_institution_id || "").trim();
  const newPassword = String(body.new_password || "");

  if (!targetInstitutionId || targetInstitutionId.length > 64) {
    return response({ error: "Enter a valid Student or Professor ID." }, 400);
  }
  if (!strongPassword(newPassword)) {
    return response({
      error: "Temporary password must be 12-128 characters and include uppercase, lowercase, number, and symbol."
    }, 400);
  }

  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count: recentCount } = await admin
    .from("password_reset_audit")
    .select("id", { count: "exact", head: true })
    .eq("admin_user_id", caller.id)
    .eq("event", "admin_reset")
    .gte("created_at", since);

  if ((recentCount || 0) >= 10) {
    return response({ error: "Too many password resets. Try again later." }, 429);
  }

  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("id,institution_id,role")
    .eq("institution_id", targetInstitutionId)
    .maybeSingle();

  if (targetError || !target) return response({ error: "Account not found." }, 404);
  if (target.id === caller.id) {
    return response({ error: "Use Change Password to update your own account." }, 400);
  }

  const { error: authError } = await admin.auth.admin.updateUserById(target.id, {
    password: newPassword
  });

  if (authError) return response({ error: "Unable to reset password." }, 500);

  const resetAt = new Date().toISOString();
  const { error: profileUpdateError } = await admin
    .from("profiles")
    .update({
      must_change_password: true,
      password_reset_at: resetAt
    })
    .eq("id", target.id);

  if (profileUpdateError) {
    return response({ error: "Password changed, but account state update failed." }, 500);
  }

  await admin.from("password_reset_audit").insert({
    admin_user_id: caller.id,
    admin_institution_id: callerProfile.institution_id,
    target_user_id: target.id,
    target_institution_id: target.institution_id,
    target_role: target.role,
    event: "admin_reset"
  });

  return response({
    success: true,
    target_institution_id: target.institution_id,
    target_role: target.role,
    must_change_password: true
  });
});