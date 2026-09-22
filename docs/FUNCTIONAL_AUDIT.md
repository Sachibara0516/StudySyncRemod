# StudySyncRemod Functional Audit

## Scope

This audit covers the entire current web system while intentionally avoiding visual redesign work.

## Original-state findings

### Authentication — critical
- Student login validated only the ID format.
- Any non-empty password was accepted.
- Professor login accepted any credentials.
- Logout cleared local variables only.
- Password update displayed a success alert but did not update authentication.

### Persistence — high
- Notes, tasks, groups, memberships, files, chats, settings, and assignment metadata were localStorage-only.
- Browser clearing or changing devices lost application data.
- No user ownership boundary existed in persistence.

### File handling — high
- Assignment "uploads" used FileReader but saved only a filename.
- Group uploads saved only a filename.
- "View Your Work" did not retrieve the file.
- There were no private URLs, storage authorization rules, size limits, or ownership checks.

### Group collaboration — high
- Groups were local objects.
- Invite member only appended an entered ID.
- No user lookup or authorization occurred.
- Any local user could delete a locally-created group.
- Chat was an in-memory/localStorage list and had no realtime synchronization.

### Security — critical
- The source contained a browser-side OpenAI API-key placeholder pattern.
- A real key inserted there would have been exposed to every visitor.
- There was no RLS because there was no database integration.
- IDs used Math.random.
- No server verification existed for protected operations.

### Data quality — medium
- Sample tasks use historical hard-coded dates.
- Static progress and announcements are illustrative rather than database-driven.
- Several operations use blocking prompt/alert flows. Those are retained because UI behavior was explicitly outside this refactor.

## Remediation implemented

### Authentication
- Added Supabase session handling.
- Added an Edge Function for ID + password login without exposing email mappings.
- The login function returns generic credential failures and never sends a secret key to the browser.
- User identity is re-verified through Supabase Auth after session establishment.
- Password updates now reauthenticate with the old password before changing the password.
- Logout calls Supabase Auth sign-out.

### Data layer
- Added a dedicated `scripts/backend.js` service boundary.
- Added Supabase-backed hydration for tasks, notes, assignments, groups, members, files, and messages.
- LocalStorage remains a resilience/demo cache rather than the production source of truth.

### Storage
- Assignments use a private `assignments` bucket.
- Group files use a private `group-files` bucket.
- Files are capped at 20 MB in client validation and bucket configuration.
- Files receive collision-resistant UUID paths.
- Viewing uses expiring signed URLs.

### Collaboration
- Group creation is transactional through a database RPC.
- Member invitation is authorized and resolves a real student profile.
- Group membership is protected with RLS.
- Group chat is persisted in Postgres and subscribes to Realtime inserts.
- Group data is cascaded through foreign keys.

### Security
- All app tables in the supplied schema have RLS enabled.
- Data API grants are explicit.
- Authorization uses `auth.uid()`, not mutable user metadata.
- A private helper schema is used for RLS helper functions.
- The one `SECURITY DEFINER` invite function checks the authenticated caller, has a fixed empty search path, revokes public/anon execution, and is explicitly granted only to authenticated users.
- Browser code uses only the publishable Supabase key.
- Server/Edge secrets stay server-side.
- OpenAI requests are moved to a Vercel server endpoint that verifies the Supabase access token before using the API key.

### Runtime quality
- Supabase JS pinned to 2.116.0.
- Node 22+ declared because current Supabase JS has dropped Node 20 support.
- Vercel security headers added.
- Network-facing operations return actionable errors and disable controls while pending.
- UUID generation replaces Math.random identifiers.

## Remaining work that requires a live Supabase project

The connected Supabase account returned no projects during this refactor. Therefore these steps cannot be truthfully marked complete yet:

- apply and test `supabase/schema.sql`
- deploy and invoke `auth-id-login`
- provision student/professor Auth users and profile mappings
- confirm Data API grants on the actual project
- run Supabase security/performance advisors
- verify Storage upload/download/delete under RLS
- verify Realtime group messages between two real sessions
- test password update and session refresh against production Auth
- disable offline demo mode for production

Once a Supabase project is connected, those should be executed and verified before calling the backend production-ready.
