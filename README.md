# MDC Training Replica

A from-scratch clone of the *look and workflow* of a roleplay server's Mobile
Data Computer (Person Lookup, DMV Database, Wanted Database, Admin panel,
etc.), built for training new staff before they touch the real system.

It is **not** built from the original server's code or assets — it's a
fresh Node.js/Express/PostgreSQL app styled to feel similar, populated with
entirely fictional demo characters. Swap the seed data, colors, and copy for
your own department.

## Stack

- Node.js + Express, server-rendered with EJS (no frontend build step)
- PostgreSQL, accessed with plain SQL via `pg` (no ORM, so there's nothing
  to compile or download at build time — just two containers)
- Session-based login (`express-session` + `connect-pg-simple`)
- Ships as a two-service Docker Compose stack: `app` + `db`

## Running it in Portainer

Your friend was right — this is exactly what Portainer calls a **Stack**
(a `docker-compose.yml` deployed as one unit).

1. Get this project onto the machine Portainer manages. Easiest path:
   push this folder to a private Git repo (GitHub/GitLab/Gitea all work),
   then in Portainer go to **Stacks → Add stack → Repository** and point it
   at the repo (root path `/`, compose path `docker-compose.yml`).
   Alternatively, choose **Upload** and upload this folder as a `.tar`/zip,
   or **Web editor** and paste the contents of `docker-compose.yml` directly.
2. Under **Environment variables**, add the values from `.env.example`
   (at minimum change `POSTGRES_PASSWORD` and `SESSION_SECRET` to your own
   values — don't ship the example ones).
3. Deploy the stack. Portainer will build the `app` image from
   `backend/Dockerfile` and start both containers. On first boot the `app`
   container waits for Postgres, creates the database tables, and (because
   `SEED_ON_START=true` by default) loads the demo characters.
4. Visit `http://<your-host>:8080` (or whatever `HOST_PORT` you set).
   Log in with `admin / admin123` or `panand / training123` — **change
   these passwords or delete these accounts once you've made your own**.

If you'd rather test locally first:

```bash
cp .env.example .env
docker compose up --build
```

Then open http://localhost:8080.

### Redeploying after you push code changes

Portainer's **Pull and redeploy** re-pulls the git repo but does **not**
force Docker to rebuild the `app` image for a `build:`-based service like
this one — if the image already exists, it just restarts the old container,
and your new code won't show up. Two reliable ways around this:

- When redeploying, look for a **"Re-pull image and rebuild"** / **"Force
  rebuild"** checkbox in Portainer's redeploy dialog and enable it.
- If that's not available (or still doesn't pick it up), delete the stack
  and recreate it from **Stacks → Add stack → Repository** with the same
  settings. Your data survives this — it lives in the named `mdc_pgdata`
  volume, not in the container.

### Redeploys won't wipe your data

The seed script only ever *adds* the fictional demo data to an **empty**
database. Once there's anything real in there — a training profile,
account, citation, whatever staff have built up through the app — it
refuses to touch the database at all, even though `SEED_ON_START=true`
still runs it on every container start/redeploy. So a new zip, a Portainer
redeploy, a container restart: none of them will ever reset what you've
built. You don't need to change anything for this — it's the default.

If you ever *do* want to wipe everything and reload the fictional demo
data (say, resetting a training environment between sessions), set
`FORCE_SEED=true` in the stack's environment variables for one redeploy,
then set it back to `false` (or remove it) afterward so the next redeploy
doesn't wipe things again. Locally, that's `FORCE_SEED=true node
sql/seed.js`.

Your data also just plain lives somewhere durable regardless: it's in the
named `mdc_pgdata` Docker volume, not in the `app` container, so it
survives a redeploy, an image rebuild, even deleting and recreating the
stack — only deleting the volume itself (or `FORCE_SEED=true`) touches it.

## Using it

- **Dashboard** — quick stats + your own logged-in profile card.
- **Person Database → Person Lookup** — search by full name (exact match,
  jumps straight to the profile — same as last-name-only if it's unique).
  From a profile: citations, infractions, vehicles, licenses, phones,
  residences, garages, businesses, arrest warrants, caution codes.
- **Person Database → DMV Database** — search by exact license plate, jumps
  to a full vehicle detail page (owner, class, paint, insurance/lease
  status, DMV record).
- **Creating an Infraction Report** — from a profile's **Actions** menu (the
  only entry point now — the redundant button that used to sit on the
  Infraction Record panel itself has been removed). The fast path is pasting
  a whole report from the reports site straight into the Narrative box — the
  app reads its `Citation(s):`/`Citation Reason(s):` lists for penal codes,
  fines, and reasons, and every `<img>` in it for an evidence gallery, with
  no manual entry needed. The `PENAL CODE`/`+ INFRACTION` buttons are there
  for reports that don't come pre-formatted — typing a code (e.g. `410`)
  opens a searchable dropdown of matching entries from the seeded
  `PenalCode` reference table (see `sql/seed.js` — the San Andreas Penal
  Code's traffic title, codes 401–418), styled after the real MDC's code
  picker. Location is picked the same way, via an **Add Location** map
  modal — an originally-drawn fictional street map (not a copy of any real
  map asset) you pan/zoom and click to drop a pin; the pin snaps to the
  nearest named zone (matching the streets already used across the seeded
  records) or falls back to a raw coordinate label if you click somewhere
  open. Every new report is filed as **Closed** — there's no separate
  confirm step, submitting is the whole action. Each penal code attached to
  the report also gets its own
  individual line in the Infraction Record table below (e.g. `IC 418.
  Prohibited Parking`) alongside the parent "Infraction Report" row, the
  same way a single-code report always has. The report row's own Remark
  column doesn't repeat that code text — it just points at those child
  lines, e.g. `Infraction #7, Infraction #8`. The report's own view page
  only shows the narrative (which already contains the pasted citation
  list) and any evidence photos — it no longer repeats the codes as a
  separate table above the narrative, and no longer lists citations issued
  from the report either (that's still tracked, just not shown there).
- **Manually-picked codes override the paste** — if a narrative documents
  more citations than the officer actually means to file (or one that
  doesn't parse cleanly), typing code(s) into the `PENAL CODE`/`+
  INFRACTION` rows before submitting is treated as the deliberate, final
  list — the narrative's own auto-detected `Citation(s):` codes are then
  ignored rather than added on top. (Previously both were merged together,
  so a two-code narrative always attached both codes even if only one was
  picked by hand.) The narrative's text and any evidence images are still
  used either way; only code auto-detection is skipped once codes are
  picked manually.
- **Offense counts on a code's label** — whatever offense wording the
  pasted report itself used ("Third or more Offense", "(2nd Offense)", …)
  is stripped out and ignored; it isn't this person's real history, just
  whatever the citing officer happened to type. Instead, every code that
  resolves against the `PenalCode` reference table gets its own count of
  how many times *this exact code* has already been filed against *this
  person*, and the label is built from that: a first offense gets no
  qualifier at all (`IC 418 — Prohibited Parking`), a second gets `(Second
  Offense)`, and a third or later gets `(Third or More Offense)` — computed
  fresh every time a report is posted, in `models.buildInfractionCodeLabel`.
- **Issuing a Citation** — a separate step from filing the report, from a
  profile's Actions menu. Amount, reason, and an optional plate/street are
  all free text. A citation with a plate attached shows up on that
  vehicle's own DMV page under **Outstanding Fines**.
- **Backdating citations/infractions** — the Admin panel's per-record "Add"
  forms for Citations and Infraction Records include an optional
  Date/Time field; leave it blank to use "now", or set it to log a past
  event.
- **Wanted Database** — active wanted persons.
- **Maps / Miscellaneous / Changelog** — placeholder pages, ready for you
  to extend.
- **Admin panel** (visible only to `admin`-role accounts) — a sticky
  quick-nav bar (Personnel / Civilians / Login Accounts / Departments, each
  with a live count) jumps straight to a section, and every table has its
  own search box (filters rows as you type) and click-to-sort column
  headers (click again to reverse). Login Accounts are either **Traffic
  Officer** (`staff` role — search records, view profiles, issue citations,
  file infraction reports) or **Administrator** (`admin` role — everything a
  Traffic Officer can do, plus this Admin panel: creating civilian/personnel
  profiles, editing every record type, and managing accounts). Traffic
  Officer accounts have no path to the Admin panel or to creating new
  civilians.
- **Onboard New Employee** (Admin panel → Personnel, or `/admin/onboard`) —
  the one-stop flow for bringing on a new officer: creates their personnel
  profile and (optionally, via a checkbox) their login account in a single
  form, instead of two separate trips through Training Profiles and Login
  Accounts. When a login account is created, a random one-time temporary
  password is generated and shown exactly once on the result page — copy it
  to hand to the new officer, because the app never shows or logs it again.
  **New Civilian Profile** (Admin panel → Civilians → `+ New Civilian
  Profile`) is the separate, shorter flow for a civilian record with no
  badge, rank, department, or login account — civilians and personnel are
  split into their own tables on the Admin panel so they're never mixed
  together.
- **Forced password change on first login** — every login account created
  with a temporary/initial password (via Onboard New Employee, or the
  standalone "Add Account" form in the Login Accounts panel) is flagged to
  require a password change. That account can sign in, but every other page
  redirects to **Change Password** until it sets its own — there's no way
  around it. Any signed-in account can also change its password voluntarily
  at any time from the key icon in the top bar.
- **Deleting a record from a profile page** — admins get a small trash-can
  button next to Arrest Warrants, Outstanding/Paid Citations, and each
  Infraction Record row, right on the person's own profile page (no need to
  detour through the Admin panel's edit form). It posts to the same
  admin-only delete route the Admin panel uses, so a Traffic Officer account
  never sees these buttons and can't hit the route directly either.
- **Phone-friendly** — the whole app is responsive down to a small phone
  screen: the sidebar collapses into a drawer (hamburger button in the top
  bar), wide tables scroll horizontally within their own card instead of
  the page, and the top bar sheds non-essential buttons at tablet widths so
  the "Log out" button (and the Change Password key icon) always stay on
  screen.

## Project layout

```
docker-compose.yml       the Portainer "stack"
.env.example             copy to .env (or paste into Portainer's env vars UI)
backend/
  Dockerfile
  docker-entrypoint.sh   waits for db, applies schema, optionally seeds, starts app
  sql/schema.sql         plain SQL table definitions (idempotent)
  sql/seed.js            fictional demo data
  src/
    app.js               Express app + session setup
    lib/db.js            pg connection pool
    lib/models.js         all SQL queries live here
    middleware/auth.js    login/role checks
    routes/               one file per section (person, dmv, wanted, admin, ...)
    views/                EJS templates + partials/top.ejs + partials/bottom.ejs (shared chrome)
    public/css/style.css  all styling — tweak this to change the look
```

## Adding more training profiles

Log in as `admin`. For a civilian, go to **Admin Panel → Civilians → + New
Civilian Profile**. For department personnel, use **Admin Panel →
Personnel → + Onboard New Employee** (creates the profile and, optionally,
a login account together). Either way, fill in the basics, save, then use
the edit page's per-section forms to attach vehicles, citations, licenses,
warrants, a wanted entry, and so on. Nothing here is real data — make up
whatever your training scenarios need.

## Notes

- This is intentionally simpler than a production MDC: no live map, no
  real-time updates, no permission tiers beyond `staff`/`admin`. Extend as
  needed — the route/model/view split above should make it straightforward
  to add a new section.
- Because there's no ORM binary to fetch, `docker compose build` only needs
  network access to the npm registry and Docker Hub (for the `node` and
  `postgres` base images) — handy if your host is behind a restrictive
  firewall.
