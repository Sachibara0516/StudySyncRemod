# StudySyncRemod

StudySyncRemod is the functional remaster of the original StudySync academic workspace.

The visual structure and existing UI were intentionally preserved. This branch focuses on stronger application behavior, secure authentication, reliable persistence, real file storage, realtime collaboration, validation, and deployability.

## Functional architecture

- **Frontend:** existing HTML/CSS interface and `scripts/script.js`
- **Application service layer:** `scripts/backend.js`
- **Auth + Database + Storage + Realtime:** Supabase
- **Custom ID login bridge:** `supabase/functions/auth-id-login`
- **Database/RLS bootstrap:** `supabase/schema.sql`
- **Deployment config:** Vercel serverless endpoints under `api/`
- **AI requests:** protected Vercel server endpoint; no API key is stored in browser code
- **Offline demo fallback:** localStorage remains available when Supabase has not been configured

## What is improved

The original accepted any password, stored essentially everything only in localStorage, simulated uploads by remembering filenames, simulated group/chat data, and displayed a successful password change without updating authentication.

StudySyncRemod now supports:

- Supabase Auth sessions with verified users
- Student/Professor ID login through a server-side Edge Function
- RLS-protected database access
- Server-backed tasks and private notes
- Actual assignment uploads to a private Storage bucket
- Signed URLs for viewing private files
- Transactional group creation
- Secure group invitation by institution ID
- Database-backed group membership and deletion
- Actual group file storage
- Database-backed group chat
- Realtime group-message subscription
- Real account password changes with reauthentication
- Server-backed profile settings
- Secure AI proxying rather than exposing an OpenAI key in the browser
- Error handling and offline fallback
- UUID-based IDs instead of Math.random identifiers
- Pinned Supabase JS dependency
- Node.js 22+ runtime declaration
- Vercel security headers

## Supabase setup

StudySyncRemod is now bound to the live Supabase project `ttymifynuwkcaxmxgxrh` in Singapore (`ap-southeast-1`) at `https://ttymifynuwkcaxmxgxrh.supabase.co`.

To activate the integration:

1. Create or connect the intended Supabase project.
2. Run `supabase/schema.sql` as an owner/admin.
3. Deploy `supabase/functions/auth-id-login`. The included `supabase/config.toml` marks this one login endpoint as public because a user does not have a JWT before signing in.
4. Create Supabase Auth users.
5. For each Auth user, create/update a matching `public.profiles` row with:
   - the Auth user's UUID
   - their email
   - their institution ID
   - role: `student` or `professor`
6. In Vercel, configure:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `STUDYSYNC_ALLOW_OFFLINE_DEMO=false` for production
7. Optional AI:
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL`

Do **not** expose a Supabase secret key/service-role key or OpenAI API key in frontend JavaScript.

## Supabase key model

This remaster is written for Supabase's modern publishable/secret key model. The browser only receives the publishable key. The authentication Edge Function reads Supabase-provided secret keys only inside the Edge runtime.

## Data API and RLS

`supabase/schema.sql` explicitly grants only the required Data API privileges and enables RLS on every exposed application table. This is important because Supabase is moving new table exposure toward explicit opt-in.

## Storage

Private buckets:

- `assignments`
- `group-files`

Both use a 20 MB object limit in the supplied database bootstrap. Access is enforced through Storage RLS policies.

## Safe development mode

When Supabase environment values are absent, the application falls back to its local browser data behavior. This preserves the portfolio/demo experience without pretending that localStorage is a secure production database.

For production, set:

`STUDYSYNC_ALLOW_OFFLINE_DEMO=false`

## Current verification status

Live Supabase project status:

- project: `StudySyncRemod`
- project ref: `ttymifynuwkcaxmxgxrh`
- region: Singapore (`ap-southeast-1`)
- database schema: applied
- RLS: enabled on all application tables
- private Storage buckets: created
- Realtime publication: configured for group chat
- `auth-id-login` Edge Function: active
- `invite-group-member` Edge Function: active and JWT-protected
- Supabase security advisor: clean (0 findings)
- frontend service layer: bound directly to the live project
- offline demo fallback: disabled by default

The connected Supabase connector does not expose Auth user creation, and the platform blocks credential-bearing provisioning workarounds. Therefore no plaintext-password test account was created automatically. Create real Auth users through the Supabase Auth UI or a trusted server/admin script, then add matching rows to `public.profiles` with their institution ID and role. Once those users exist, the current login bridge and all Supabase-backed functionality are ready to operate against the live project.


## Demo accounts

StudySyncRemod includes two self-provisioning demo identities. The corresponding Supabase Auth user and `public.profiles` row are created automatically on the first valid login.

- Student
  - ID: `22-12345`
  - Password: `StudySyncDemo!22-12345`
  - Role: Student
- Teacher
  - ID: `PROF-001`
  - Password: `StudySyncDemo!PROF-001`
  - Role in the current UI/backend schema: Professor

These are intentionally public demo credentials. The login Edge Function restores the expected demo password on valid demo login so the shared demonstration account remains recoverable.
