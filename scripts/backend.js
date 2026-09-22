const SUPABASE_MODULE_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm";
const CONFIG_ENDPOINT = "/api/config";
const REQUEST_TIMEOUT_MS = 8000;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function withTimeout(ms = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function safeFilename(name = "file") {
  return name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120) || "file";
}

function normalizeRole(role) {
  const value = String(role || "").trim().toLowerCase();
  if (!["student", "professor"].includes(value)) {
    throw new Error("Unsupported account role.");
  }
  return value;
}

function mapSupabaseError(error, fallback = "The request could not be completed.") {
  if (!error) return new Error(fallback);
  const message = String(error.message || fallback);
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials")) return new Error("Invalid ID or password.");
  if (normalized.includes("jwt") || normalized.includes("session")) return new Error("Your session expired. Please sign in again.");
  if (normalized.includes("row-level security") || normalized.includes("permission denied")) return new Error("You do not have permission to perform this action.");
  if (normalized.includes("duplicate") || normalized.includes("unique")) return new Error("That item already exists.");
  return new Error(message);
}

class StudySyncBackend {
  constructor() {
    this.client = null;
    this.configured = false;
    this.allowOfflineDemo = true;
    this.user = null;
    this.profile = null;
    this.initialized = false;
    this.groupChannel = null;
  }

  async init() {
    if (this.initialized) return this.status();
    this.initialized = true;

    let config = window.STUDYSYNC_CONFIG || null;
    if (!config) {
      const timeout = withTimeout(3500);
      try {
        const response = await fetch(CONFIG_ENDPOINT, { cache: "no-store", signal: timeout.signal });
        if (response.ok) config = await response.json();
      } catch (error) {
        if (error?.name !== "AbortError") console.warn("StudySync config endpoint unavailable:", error);
      } finally {
        timeout.clear();
      }
    }

    this.allowOfflineDemo = config?.allowOfflineDemo !== false;
    const url = config?.supabaseUrl?.trim();
    const key = config?.supabasePublishableKey?.trim();

    if (!url || !key) {
      console.warn("StudySync is running in offline demo mode because Supabase is not configured.");
      return this.status();
    }

    try {
      const { createClient } = await import(SUPABASE_MODULE_URL);
      this.client = createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: "studysync-remod-auth"
        },
        global: {
          headers: { "X-Client-Info": "studysync-remod/2.0" }
        }
      });
      this.configured = true;

      const { data, error } = await this.client.auth.getUser();
      if (!error && data?.user) {
        this.user = data.user;
        await this.loadProfile();
      }
    } catch (error) {
      console.error("Supabase initialization failed:", error);
      this.client = null;
      this.configured = false;
    }
    return this.status();
  }

  status() {
    return {
      configured: this.configured,
      offlineDemo: !this.configured,
      signedIn: Boolean(this.user),
      user: this.user,
      profile: this.profile
    };
  }

  async loadProfile() {
    if (!this.client || !this.user) return null;
    const { data, error } = await this.client
      .from("profiles")
      .select("id,institution_id,role,display_name,email_notifications")
      .eq("id", this.user.id)
      .single();
    if (error) throw mapSupabaseError(error, "Unable to load account profile.");
    this.profile = data;
    return data;
  }

  async signIn({ role, institutionId, password }) {
    await this.init();
    const normalizedRole = normalizeRole(role);
    const id = String(institutionId || "").trim();

    if (!this.configured) {
      if (!this.allowOfflineDemo) throw new Error("StudySync is not connected to its authentication service.");
      this.user = { id: `offline:${id || normalizedRole}`, email: null };
      this.profile = {
        id: this.user.id,
        institution_id: id || null,
        role: normalizedRole,
        display_name: "",
        email_notifications: false,
        offline: true
      };
      return { user: this.user, profile: this.profile, offline: true };
    }

    const { data, error } = await this.client.functions.invoke("auth-id-login", {
      body: {
        role: normalizedRole,
        institution_id: id,
        password: String(password || "")
      }
    });

    if (error || !data?.session?.access_token || !data?.session?.refresh_token) {
      throw mapSupabaseError(error || data?.error, "Invalid ID or password.");
    }

    const { error: sessionError } = await this.client.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token
    });
    if (sessionError) throw mapSupabaseError(sessionError, "Unable to establish a secure session.");

    const { data: userData, error: userError } = await this.client.auth.getUser();
    if (userError || !userData?.user) throw mapSupabaseError(userError, "Unable to verify your session.");

    this.user = userData.user;
    await this.loadProfile();

    if (this.profile?.role !== normalizedRole || this.profile?.institution_id !== id) {
      await this.client.auth.signOut();
      this.user = null;
      this.profile = null;
      throw new Error("The selected role or account ID does not match this account.");
    }

    return { user: this.user, profile: this.profile, offline: false };
  }

  async signOut() {
    this.unsubscribeGroup();
    if (this.client && this.user) {
      const { error } = await this.client.auth.signOut();
      if (error) console.warn("Supabase sign-out warning:", error);
    }
    this.user = null;
    this.profile = null;
  }

  async requireUser() {
    if (!this.configured) return this.user;
    const { data, error } = await this.client.auth.getUser();
    if (error || !data?.user) throw mapSupabaseError(error, "Please sign in again.");
    this.user = data.user;
    return data.user;
  }

  async hydrateState(localState) {
    await this.init();
    if (!this.configured || !this.user) return localState;
    await this.requireUser();

    const [
      tasksResult,
      notesResult,
      assignmentsResult,
      groupsResult,
      membersResult,
      filesResult,
      messagesResult
    ] = await Promise.all([
      this.client.from("tasks").select("id,title,description,due_date,completed,created_at").eq("owner_id", this.user.id).order("created_at"),
      this.client.from("notes").select("note_key,content").eq("owner_id", this.user.id),
      this.client.from("assignments").select("assignment_key,file_name,storage_path").eq("owner_id", this.user.id),
      this.client.from("groups").select("id,name,created_by,created_at").order("created_at"),
      this.client.from("group_members").select("group_id,institution_id,role,joined_at").order("joined_at"),
      this.client.from("group_files").select("id,group_id,file_name,storage_path,uploader_id,uploaded_at").order("uploaded_at"),
      this.client.from("group_messages").select("id,group_id,body,sender_label,sender_id,created_at").order("created_at")
    ]);

    const results = [tasksResult, notesResult, assignmentsResult, groupsResult, membersResult, filesResult, messagesResult];
    const failure = results.find(r => r.error);
    if (failure?.error) throw mapSupabaseError(failure.error, "Unable to synchronize StudySync data.");

    const notes = {};
    for (const row of notesResult.data || []) notes[row.note_key] = row.content || "";

    const assignments = {};
    for (const row of assignmentsResult.data || []) {
      assignments[row.assignment_key] = {
        name: row.file_name,
        storage_path: row.storage_path
      };
    }

    const members = {};
    for (const row of membersResult.data || []) {
      if (!members[row.group_id]) members[row.group_id] = [];
      members[row.group_id].push(row.institution_id || "Member");
    }

    const files = {};
    for (const row of filesResult.data || []) {
      if (!files[row.group_id]) files[row.group_id] = [];
      files[row.group_id].push({
        id: row.id,
        name: row.file_name,
        storage_path: row.storage_path,
        uploader_id: row.uploader_id
      });
    }

    const chats = {};
    for (const row of messagesResult.data || []) {
      if (!chats[row.group_id]) chats[row.group_id] = [];
      chats[row.group_id].push({
        id: row.id,
        text: `${row.sender_label || "User"}: ${row.body}`,
        body: row.body,
        sender_id: row.sender_id,
        created_at: row.created_at
      });
    }

    return {
      ...localState,
      notes,
      assignments,
      tasks: (tasksResult.data || []).map(row => ({ ...row })),
      groups: (groupsResult.data || []).map(row => ({
        group_id: row.id,
        group_name: row.name,
        created_by: row.created_by
      })),
      members,
      files,
      chats
    };
  }

  async saveNote(noteKey, content) {
    if (!this.configured || !this.user) return;
    const { error } = await this.client.from("notes").upsert({
      owner_id: this.user.id,
      note_key: noteKey,
      content: String(content || "")
    }, { onConflict: "owner_id,note_key" });
    if (error) throw mapSupabaseError(error, "Unable to save note.");
  }

  async createTask(task) {
    if (!this.configured || !this.user) return { ...task, id: crypto.randomUUID() };
    const { data, error } = await this.client.from("tasks").insert({
      owner_id: this.user.id,
      title: String(task.title || "").trim(),
      description: String(task.description || ""),
      due_date: task.due_date || null,
      completed: Boolean(task.completed)
    }).select("id,title,description,due_date,completed,created_at").single();
    if (error) throw mapSupabaseError(error, "Unable to create task.");
    return data;
  }

  async updateTask(task) {
    if (!this.configured || !this.user || !task?.id) return task;
    const { data, error } = await this.client.from("tasks")
      .update({
        title: task.title,
        description: task.description || "",
        due_date: task.due_date || null,
        completed: Boolean(task.completed)
      })
      .eq("id", task.id)
      .eq("owner_id", this.user.id)
      .select("id,title,description,due_date,completed,created_at")
      .single();
    if (error) throw mapSupabaseError(error, "Unable to update task.");
    return data;
  }

  async deleteTask(task) {
    if (!this.configured || !this.user || !task?.id) return;
    const { error } = await this.client.from("tasks")
      .delete()
      .eq("id", task.id)
      .eq("owner_id", this.user.id);
    if (error) throw mapSupabaseError(error, "Unable to delete task.");
  }

  async uploadAssignment(assignmentKey, file) {
    if (!(file instanceof File)) throw new Error("Choose a valid file.");
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("Files must be 20 MB or smaller.");
    if (!this.configured || !this.user) return { name: file.name, storage_path: null, offline: true };

    const path = `${this.user.id}/${encodeURIComponent(assignmentKey)}/${crypto.randomUUID()}-${safeFilename(file.name)}`;
    const { error: uploadError } = await this.client.storage.from("assignments").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "application/octet-stream"
    });
    if (uploadError) throw mapSupabaseError(uploadError, "Unable to upload assignment.");

    const { data, error } = await this.client.from("assignments").upsert({
      owner_id: this.user.id,
      assignment_key: assignmentKey,
      file_name: file.name,
      storage_path: path
    }, { onConflict: "owner_id,assignment_key" }).select("assignment_key,file_name,storage_path").single();

    if (error) {
      await this.client.storage.from("assignments").remove([path]);
      throw mapSupabaseError(error, "Unable to save assignment metadata.");
    }
    return { name: data.file_name, storage_path: data.storage_path };
  }

  async getAssignmentUrl(record) {
    if (!this.configured || !record?.storage_path) return null;
    const { data, error } = await this.client.storage.from("assignments").createSignedUrl(record.storage_path, 60);
    if (error) throw mapSupabaseError(error, "Unable to open assignment.");
    return data?.signedUrl || null;
  }

  async createGroup(name) {
    const cleanName = String(name || "").trim();
    if (!cleanName) throw new Error("Please enter a group name.");
    if (!this.configured || !this.user) {
      return { group_id: crypto.randomUUID(), group_name: cleanName, created_by: this.user?.id || null };
    }

    const { data, error } = await this.client.rpc("create_study_group", { p_name: cleanName });
    if (error) throw mapSupabaseError(error, "Unable to create group.");
    const row = Array.isArray(data) ? data[0] : data;
    return {
      group_id: row.id || row.group_id,
      group_name: row.name || row.group_name || cleanName,
      created_by: row.created_by || this.user.id
    };
  }

  async inviteGroupMember(groupId, institutionId) {
    if (!this.configured || !this.user) return { institution_id: institutionId };
    const { data, error } = await this.client.rpc("invite_group_member", {
      p_group_id: groupId,
      p_institution_id: String(institutionId || "").trim()
    });
    if (error) throw mapSupabaseError(error, "Unable to invite member.");
    return data;
  }

  async leaveGroup(groupId) {
    if (!this.configured || !this.user) return;
    const { error } = await this.client.from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", this.user.id);
    if (error) throw mapSupabaseError(error, "Unable to leave group.");
  }

  async deleteGroup(groupId) {
    if (!this.configured || !this.user) return;
    const { error } = await this.client.from("groups").delete().eq("id", groupId);
    if (error) throw mapSupabaseError(error, "Unable to delete group.");
  }

  async uploadGroupFile(groupId, file) {
    if (!(file instanceof File)) throw new Error("Choose a valid file.");
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("Files must be 20 MB or smaller.");
    if (!this.configured || !this.user) return { id: crypto.randomUUID(), name: file.name, storage_path: null };

    const path = `${groupId}/${this.user.id}/${crypto.randomUUID()}-${safeFilename(file.name)}`;
    const { error: uploadError } = await this.client.storage.from("group-files").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "application/octet-stream"
    });
    if (uploadError) throw mapSupabaseError(uploadError, "Unable to upload group file.");

    const { data, error } = await this.client.from("group_files").insert({
      group_id: groupId,
      uploader_id: this.user.id,
      file_name: file.name,
      storage_path: path
    }).select("id,file_name,storage_path,uploader_id").single();

    if (error) {
      await this.client.storage.from("group-files").remove([path]);
      throw mapSupabaseError(error, "Unable to save group file metadata.");
    }
    return { id: data.id, name: data.file_name, storage_path: data.storage_path, uploader_id: data.uploader_id };
  }

  async deleteGroupFile(file) {
    if (!this.configured || !this.user || !file) return;
    if (file.storage_path) {
      const { error: storageError } = await this.client.storage.from("group-files").remove([file.storage_path]);
      if (storageError) throw mapSupabaseError(storageError, "Unable to delete stored file.");
    }
    if (file.id) {
      const { error } = await this.client.from("group_files").delete().eq("id", file.id);
      if (error) throw mapSupabaseError(error, "Unable to delete file record.");
    }
  }

  async getGroupFileUrl(file) {
    if (!this.configured || !file?.storage_path) return null;
    const { data, error } = await this.client.storage.from("group-files").createSignedUrl(file.storage_path, 60);
    if (error) throw mapSupabaseError(error, "Unable to open group file.");
    return data?.signedUrl || null;
  }

  async sendGroupMessage(groupId, body) {
    const cleanBody = String(body || "").trim();
    if (!cleanBody) return null;
    const label = this.profile?.institution_id || this.profile?.display_name || "User";
    if (!this.configured || !this.user) {
      return { id: crypto.randomUUID(), text: `${label}: ${cleanBody}`, body: cleanBody, sender_id: this.user?.id || null };
    }
    const { data, error } = await this.client.from("group_messages").insert({
      group_id: groupId,
      sender_id: this.user.id,
      sender_label: label,
      body: cleanBody
    }).select("id,body,sender_label,sender_id,created_at").single();
    if (error) throw mapSupabaseError(error, "Unable to send message.");
    return { ...data, text: `${data.sender_label || "User"}: ${data.body}` };
  }

  subscribeToGroupMessages(groupId, onMessage) {
    this.unsubscribeGroup();
    if (!this.configured || !this.client) return;
    this.groupChannel = this.client
      .channel(`studysync-group-${groupId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "group_messages",
        filter: `group_id=eq.${groupId}`
      }, payload => {
        const row = payload.new;
        onMessage?.({ ...row, text: `${row.sender_label || "User"}: ${row.body}` });
      })
      .subscribe();
  }

  unsubscribeGroup() {
    if (this.groupChannel && this.client) {
      this.client.removeChannel(this.groupChannel);
    }
    this.groupChannel = null;
  }

  async getSettings(localFallback = {}) {
    if (!this.configured || !this.user) return localFallback;
    if (!this.profile) await this.loadProfile();
    return {
      displayName: this.profile?.display_name || "",
      emailNotifications: Boolean(this.profile?.email_notifications)
    };
  }

  async saveSettings(settings) {
    if (!this.configured || !this.user) return settings;
    const { data, error } = await this.client.from("profiles")
      .update({
        display_name: String(settings.displayName || "").trim(),
        email_notifications: Boolean(settings.emailNotifications),
        updated_at: new Date().toISOString()
      })
      .eq("id", this.user.id)
      .select("display_name,email_notifications")
      .single();
    if (error) throw mapSupabaseError(error, "Unable to save settings.");
    this.profile = { ...this.profile, ...data };
    return {
      displayName: data.display_name || "",
      emailNotifications: Boolean(data.email_notifications)
    };
  }

  async updatePassword(oldPassword, newPassword) {
    if (String(newPassword || "").length < 8) {
      throw new Error("New password must be at least 8 characters.");
    }
    if (!this.configured || !this.user) return true;

    const institutionId = this.profile?.institution_id;
    const role = this.profile?.role;
    if (!institutionId || !role) throw new Error("Account profile is incomplete.");

    await this.signIn({ role, institutionId, password: oldPassword });
    const { error } = await this.client.auth.updateUser({ password: newPassword });
    if (error) throw mapSupabaseError(error, "Unable to update password.");
    return true;
  }

  async askAI(prompt) {
    if (!this.configured || !this.client) throw new Error("AI assistance requires the connected StudySync backend.");
    const { data: sessionData } = await this.client.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error("Please sign in again before using AI assistance.");

    const response = await fetch("/api/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ prompt: String(prompt || "").slice(0, 8000) })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || "AI assistance is unavailable.");
    return data.text || "No response.";
  }
}

export const backend = new StudySyncBackend();
export { mapSupabaseError };
