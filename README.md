# Mock Exam

A practice-test website that looks and works like the digital AP testing app. It has a live proctor dashboard for whoever runs the test.

**Test takers get:**
- a sign-in page
- a split passage/question layout with a resizable divider
- a timer that can be hidden and turns red at 5:00
- Directions, Mark for Review, answer cross-out, and the question menu
- highlights, underlines, and notes
- a Check Your Work page
- an automatic move-on when time runs out
- a scheduled break, an unscheduled break, and Exit the Exam
- a free-response editor
- a finish screen

**You (the proctor) get a live dashboard with:**
- everyone's current question
- their selected answers (right or wrong if you add an answer key)
- their free-response text and time left
- an alert, with the question number, whenever someone **leaves the exam tab or window**

Test takers are never blocked when they leave the tab. It's just logged so you can act on it. From the dashboard you can message someone, add or remove time, end a section, end the exam, let someone back in after they exit, or reset their attempt.

---

## What's in this folder

| Path | What it is |
|---|---|
| `public/` | The website itself: pages, styles, scripts, and fonts. |
| `api/` | Three small server functions that Vercel runs: `auth`, `exam` and `admin`. |
| `lib/` | Shared server code: database, sign-in, timing rules, and test validation. |
| `db/schema.sql` | Creates the database tables and the proctor account. You run it once. |
| `tests/sample-exam.json` | A sample test with placeholder questions that uses every feature. |
| `tests/quick-demo.json` | A 2-minute test for trying out the timers and the break. |
| `tests/FORMAT.md` | How to write your own test files. |
| `public/assets/js/config.js` | The app name and sign-in wording. Change them here. |
| `dev/server.mjs` | An optional way to run everything on your own computer. Vercel doesn't use it. |

---

## Put it online with Vercel and a free database (about 15 minutes)

### 1. Put the code on GitHub
1. Make a free account at github.com.
2. Click **+ → New repository**, name it (for example `mock-exam`), choose **Private**, and click **Create repository**.
3. On the new repo page, click **uploading an existing file**.
4. Drag in **everything inside this folder** (not the folder itself, and not `node_modules` if you have it), then click **Commit changes**.

### 2. Create the Vercel project
1. Make a free account at vercel.com. Sign up with GitHub, which is easiest.
2. Click **Add New… → Project** and **Import** your `mock-exam` repo.
3. Leave the settings as they are. The framework preset is **Other**, and `vercel.json` already handles the rest.
4. Click **Deploy**. The site goes live but can't sign anyone in yet, because it has no database.

### 3. Add a Postgres database
1. In your Vercel project, open the **Storage** tab, then click **Create Database** and choose **Neon** (Serverless Postgres).
2. Keep the free plan, pick a region near you, and click **Create**.
3. When asked, connect it to your `mock-exam` project with all environments checked. Vercel adds a `DATABASE_URL` setting to your project automatically.
4. Go to **Deployments**, click **⋯** on the latest deployment, and choose **Redeploy** so the site picks up the database.

### 4. Create the tables (run the SQL)
1. In Vercel, go to **Storage → your database → Open in Neon**. This opens the Neon console.
2. In Neon, click **SQL Editor** in the left menu.
3. Open `db/schema.sql` from this folder, copy everything, paste it into the editor, and click **Run**.

It's safe to run again later. It never deletes anything.

### 5. Sign in as the proctor
Open your site at `https://<your-project>.vercel.app`. The made-up proctor login is:

```
Username: proctor
Password: Proctor-2026!
```

**Change that password right away:** go to **Accounts → Proctor → Reset password**.

Then:
1. Go to **Tests** and upload `tests/sample-exam.json` (or your own test).
2. Turn on **Open to test takers**.
3. Optionally, set a **Start code**. Test takers must type it before they can begin, like the real exam.

### 6. Create logins for your friends
Use either option. There's no sign-up page, so only people you create can sign in.

**Option A: the dashboard.** Go to **Accounts → Add an account**. Click **Generate** for an easy password.

**Option B: SQL** (in the Neon SQL Editor, like step 4):

```sql
-- add one person
insert into users (username, display_name, password_hash)
values ('avery', 'Avery Jordan', crypt('maple-river-42', gen_salt('bf', 10)));

-- add several at once
insert into users (username, display_name, password_hash) values
  ('sam',   'Sam Lee',     crypt('comet-piano-17', gen_salt('bf', 10))),
  ('jules', 'Jules Ortiz', crypt('cedar-orbit-63', gen_salt('bf', 10)));

-- change someone's password
update users set password_hash = crypt('new-password', gen_salt('bf', 10)) where username = 'sam';

-- make someone else a proctor too
update users set role = 'admin' where username = 'jules';

-- see everyone
select id, username, display_name, role, created_at from users order by id;

-- remove someone (also deletes their answers)
delete from users where username = 'sam';
```

Passwords are stored scrambled (bcrypt), never as plain text. Use the plain password only in the `crypt('…')` part.

---

## Running a test day
1. **Before:** upload the test, set a start code, and leave the test **closed**.
2. **When everyone's ready:**
   - Turn on **Open to test takers** and have everyone sign in.
   - Say the start code out loud. Each person starts with their own full time. A directions page comes first, and the clock doesn't start until they click **Begin Testing**.
3. **During:** keep the **Live** tab open.
   - A red **LEFT EXAM** tag appears, with a running timer, when someone switches tabs, minimizes the window, or clicks outside it.
   - The **Activity** feed lists each event with the question number. Turn on **Alert sound** to hear a beep.
   - Click anyone's row to see every answer, which question they're on right now, their essays, and their full activity log.
4. **Actions** (in the row's side panel):
   - **Send a message**: pops up on their screen.
   - **Change time**: add or remove minutes.
   - **End current section**
   - **End exam now**
   - **Let them back in**: after they used *Exit the Exam*. Their clock is paused while they're out.
   - **Reset attempt**: lets them start over.

### How timing works (same as the real app)
- The server keeps the clock. Refreshing the page or closing the laptop never resets or pauses it, except for Exit the Exam.
- When a section's time runs out, everyone moves on automatically. Answers chosen in the final seconds are still saved.
- By default nobody can move on early. Set `"allowEarlySubmit": true` in a test file to allow it.
- **Unscheduled Break** keeps the clock running. **Exit the Exam** pauses the clock and waits for you to let them back in.

---

## Try it on your own computer first (optional)
You need Node.js 20 or newer from nodejs.org. Then, in this folder, run:

```bash
npm install
npm run dev
```

Open http://localhost:3000. The local version uses a temporary in-memory database with the sample tests already open, and it resets when you stop it. Logins:

- `proctor` / `Proctor-2026!`
- `avery` / `avery123`
- `sam` / `sam123`

Sign in as the proctor in one browser and as `avery` in a private window to see both sides.

---

## Customizing
- **App name and sign-in text:** edit `public/assets/js/config.js`, then commit the change on GitHub. Vercel redeploys automatically.
- **Writing tests:** see `tests/FORMAT.md`. Upload new versions from the dashboard; no redeploy needed.
- **Images in tests:** put files in `public/images/` and refer to them as `/images/name.png`, or use any public image URL.

## Good to know
- Highlights and notes are saved in each test taker's browser. They survive refreshes on the same device but don't show up on the dashboard. Answers, flags and cross-outs are saved to the server.
- Leaving the exam is detected from inside the browser: switching tabs, minimizing, or clicking outside the window. It can't see a second device, like a phone.
- Copying text from passages is blocked. In essays, test takers can only paste text they copied from their own response, and blocked attempts appear on the dashboard.
- The free Vercel and Neon plans are plenty for a group of friends. The Neon database sleeps when unused, so the first sign-in after a while can take a few seconds.

## Troubleshooting
| You see | Fix |
|---|---|
| "No database is connected" | Do step 3, then **Redeploy**. |
| "The database tables are missing" | Do step 4 (run `db/schema.sql`). |
| Forgot the proctor password | In the Neon SQL Editor: `update users set password_hash = crypt('NewPassword1', gen_salt('bf', 10)) where username = 'proctor';` |
| Test upload shows errors | Each line says what to fix and where, e.g. "Section 2, question 1". |
| A test taker sees "No tests are open" | Turn on **Open to test takers** for that test. |
