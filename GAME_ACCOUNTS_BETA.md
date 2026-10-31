# IRON SHIFT account BETA (not for commercial release)

This branch keeps the upstream game engine, maps, guns, bots, and browser-to-browser PeerJS matches unchanged. The `game-server/` Node app serves the completed IRON SHIFT game and a dedicated account API under the same origin. The game client already has registration/login/profile screens that call these endpoints.

**Works once DATABASE_URL is set:** create account with username and password, recovery code, sign in/out, edit profile, export/delete user data, save and load loadouts, basic saved match history and XP, basic leaderboard; existing PeerJS friend-hosted matches use original game's shared lobby codes.

**Not yet included:** official dedicated matchmaking/relay, anti-cheat, secure server-authoritative economy, moderation/community/friends endpoints, payment system. Beta match reports and arsenal data are user-supplied and **must not** be used for paid/competitive rewards.

## Render test deployment

1. Render Postgres **iron-shift-test-users** was created in Frankfurt (free and TEMPORARY, expires **2026-11-30**). Its data may be deleted when the free period ends.
2. Create a Render web service from this repository at branch `iron-shift-accounts-preview`, Docker runtime, Dockerfile `./Dockerfile.accounts`, Frankfurt, free plan.
3. In the database's Render Dashboard, choose **Connect → Internal Database URL**. In the web service's **Environment** section, set `DATABASE_URL` to the complete URL **using the Render dashboard only** (never put it in GitHub or chat). This DB was not automatically bound during deployment. Same-region internal URL avoids external network routing.
4. Leave `DB_SSL` unset for internal Render connection (or set it as required by Render). Redeploy the web service.
5. Verify `GET /api/health` returns `{"status":"ready","dbConnected":true,...}`.
6. Register a disposable test account in the game's Profile screen. Keep its recovery code; it is shown once.
7. For public launch, replace the free DB with long-lived paid storage, add backups, implement full legal notices, confirm all audio/animation/material rights, and perform a security review.

Privacy: server stores username, display name, salted scrypt password and recovery hashes, sessions hashed with SHA-256 in HTTP-only Secure cookies, game loadouts, account XP and match history. No email, billing or payment details. Sessions last 30 days. Deleting an account cascades to sessions and match history. Only test with accounts and data you can afford to lose.

The original public test sites `riposte-frontline-preview.onrender.com` and `iron-shift-preview.onrender.com` are **not** modified by this branch.
