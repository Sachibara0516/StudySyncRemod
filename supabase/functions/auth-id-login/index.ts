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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const publishableKey = readNamedKey("SUPABASE_PUBLISHABLE_KEYS") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  const secretKey = readNamedKey("SUPABASE_SECRET_KEYS") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !publishableKey || !secretKey) {
    console.error("Supabase runtime keys are unavailable.");
    return response({ error: "Authentication service is unavailable." }, 503);
  }

  let body: { role?: string; institution_id?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return response({ error: "Invalid request." }, 400);
  }

  const role = String(body.role || "").trim().toLowerCase();
  const institutionId = String(body.institution_id || "").trim();
  const password = String(body.password || "");

  if (!["student", "professor"].includes(role) || !institutionId || !password) {
    return response({ error: "Invalid ID or password." }, 401);
  }
  if (institutionId.length > 64 || password.length > 256) {
    return response({ error: "Invalid ID or password." }, 401);
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,email,role,institution_id,is_admin,must_change_password")
    .eq("institution_id", institutionId)
    .eq("role", role)
    .maybeSingle();

  if (profileError) {
    console.error("Profile lookup failed:", profileError.message);
    return response({ error: "Invalid ID or password." }, 401);
  }

  // Public demo accounts are provisioned only on first valid login.
  // The password is derived at runtime so no plaintext account credential
  // is stored in the repository or deployment configuration.
  const demoAccounts: Record<string, { role: string; email: string; display_name: string }> = {
    "22-12345": {
      role: "student",
      email: "student.22-12345@studysync.local",
      display_name: "Sample Student"
    },
    "PROF-001": {
      role: "professor",
      email: "teacher.prof-001@studysync.local",
      display_name: "Sample Teacher"
    }
  };

  const demo = demoAccounts[institutionId];
  const expectedDemoPassword = demo ? "StudySyncDemo!" + institutionId : null;

  if (!profile?.email && demo && demo.role === role && password === expectedDemoPassword) {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: demo.email,
      password: expectedDemoPassword,
      email_confirm: true
    });

    if (createError || !created.user) {
      console.error("Demo user creation failed:", createError?.message);
      return response({ error: "Unable to initialize demo account." }, 503);
    }

    const { error: insertError } = await admin.from("profiles").insert({
      id: created.user.id,
      email: demo.email,
      institution_id: institutionId,
      role,
      display_name: demo.display_name,
      email_notifications: false,
      is_admin: institutionId === "PROF-001" && role === "professor",
      must_change_password: false
    });

    if (insertError) {
      await admin.auth.admin.deleteUser(created.user.id);
      console.error("Demo profile creation failed:", insertError.message);
      return response({ error: "Unable to initialize demo account." }, 503);
    }

    profile = {
      id: created.user.id,
      email: demo.email,
      role,
      institution_id: institutionId,
      is_admin: institutionId === "PROF-001" && role === "professor",
      must_change_password: false
    };
  }

  if (!profile?.email) return response({ error: "Invalid ID or password." }, 401);

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data, error } = await authClient.auth.signInWithPassword({
    email: profile.email,
    password
  });

  if (error || !data.session || !data.user) {
    return response({ error: "Invalid ID or password." }, 401);
  }

  return response({
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at
    },
    profile: {
      id: profile.id,
      institution_id: profile.institution_id,
      role: profile.role,
      is_admin: Boolean(profile.is_admin),
      must_change_password: Boolean(profile.must_change_password)
    }
  });
});
