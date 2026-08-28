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

### Turning off auto-seeding

`SEED_ON_START=true` re-runs the seed script (which wipes and rewrites all
tables) every time the `app` container starts. That's convenient while
you're experimenting, but once you've built out real training profiles
through the Admin panel, set `SEED_ON_START=false` in the stack's
environment variables and redeploy — otherwise your edits get reset on the
next restart.

## Using it

- **Dashboard** — quick stats + your own logged-in profile card.
- **Person Database → Person Lookup** — search by full name (exact match,
  jumps straight to the profile — same as last-name-only if it's unique).
  From a profile: citations, infractions, vehicles, licenses, phones,
  residences, garages, businesses, arrest warrants, caution codes.
- **Person Database → DMV Database** — search by exact license plate, jumps
  to a full vehicle detail page (owner, class, paint, insurance/lease
  status, DMV record).
- **Creating an Infraction Report** — from a profile's **Actions** menu (or
  the **+ Infraction Report** button on the Infraction Record panel). The
  fast path is pasting a whole report from the reports site straight into
  the Narrative box — the app reads its `Citation(s):`/`Citation
  Reason(s):` lists for penal codes, fines, and reasons, and every `<img>`
  in it for an evidence gallery, with no manual entry needed. The `PENAL
  CODE`/`+ INFRACTION` buttons are there for reports that don't come
  pre-formatted, matching typed codes (e.g. `410`) against the seeded
  `PenalCode` reference table (see `sql/seed.js` — the San Andreas Penal
  Code's traffic title, codes 401–418). Every new report is filed as
  **Closed** — there's no separate confirm step, submitting is the whole
  action. Each penal code attached to the report also gets its own
  individual line in the Infraction Record table below (e.g. `IC 418.
  Prohibited Parking`) alongside the parent "Infraction Report" row, the
  same way a single-code report always has. The report's own view page only
  shows the narrative (which already contains the pasted citation list) —
  it no longer repeats it as a separate table above the narrative.
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
- **Issuing a Citation** — a separate step from filing the report: either
  from a profile's Actions menu, or the "Issue Citation" link on an
  infraction report's View Record page (which pre-links the citation back
  to that report and pre-fills amount/reason). Amount, reason, and an
  optional plate/street are all free text. A citation with a plate attached
  shows up on that vehicle's own DMV page under **Outstanding Fines**.
- **Backdating citations/infractions** — the Admin panel's per-record "Add"
  forms for Citations and Infraction Records include an optional
  Date/Time field; leave it blank to use "now", or set it to log a past
  event.
- **Wanted Database** — active wanted persons.
- **Maps / Miscellaneous / Changelog** — placeholder pages, ready for you
  to extend.
- **Admin panel** (visible only to `admin`-role accounts) — create/edit/
  delete training profiles and every record type hanging off them, plus
  manage login accounts and departments. Login Accounts are either
  **Traffic Officer** (`staff` role — search records, view profiles, issue
  citations, file infraction reports) or **Administrator** (`admin` role —
  everything a Traffic Officer can do, plus this Admin panel: creating
  civilian/personnel profiles, editing every record type, and managing
  accounts). Traffic Officer accounts have no path to the Admin panel or to
  creating new civilians — that stays deliberately separate, in its own
  "Training Profiles" panel here.
- **Deleting a record from a profile page** — admins get a small trash-can
  button next to Arrest Warrants, Outstanding/Paid Citations, and each
  Infraction Record row, right on the person's own profile page (no need to
  detour through the Admin panel's edit form). It posts to the same
  admin-only delete route the Admin panel uses, so a Traffic Officer account
  never sees these buttons and can't hit the route directly either.

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

Log in as `admin`, go to **Admin Panel → + New Profile**, fill in the
basics, save, then use the edit page's per-section forms to attach
vehicles, citations, licenses, warrants, a wanted entry, and so on. Nothing
here is real data — make up whatever your training scenarios need.

## Notes

- This is intentionally simpler than a production MDC: no live map, no
  real-time updates, no permission tiers beyond `staff`/`admin`. Extend as
  needed — the route/model/view split above should make it straightforward
  to add a new section.
- Because there's no ORM binary to fetch, `docker compose build` only needs
  network access to the npm registry and Docker Hub (for the `node` and
  `postgres` base images) — handy if your host is behind a restrictive
  firewall.
