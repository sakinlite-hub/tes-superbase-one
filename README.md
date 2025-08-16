# CalcChat

A free, calculator-lock, one-on-one chat app using HTML/CSS/JS on Netlify/Vercel and Supabase (Auth + Postgres + Realtime).

## Features

- Calculator UI as lock screen. Enter passcode then press = to unlock chat.
- Supabase Auth (email/password).
- Secure passcode hashing on the server (bcrypt via pgcrypto) using RPC.
- Real-time: direct messages and presence updates via Supabase Realtime.
- User list with online indicator or "time ago" last active.
- Messages: text and TikTok URLs (embedded inline).
- Responsive modern UI.

## 1) Setup Supabase

1. Create a project at https://supabase.com (free tier).
2. In SQL editor, run the contents of `sql/schema.sql`.
3. In Dashboard > Authentication > Providers, ensure Email/Password is enabled.
4. In Database > Replication > Realtime, enable for `public.profiles` and `public.messages` (if not already).

Notes:
- The SQL enables `pgcrypto` and adds RPC functions `set_passcode(passcode text)` and `verify_passcode(passcode text)`.
- RLS is enabled. The app reads public profile fields via `get_public_profiles()` so the passcode hash is never exposed.

## 2) Configure the frontend

- Copy `config.example.js` to `config.js` and fill in:

```js
window.SUPABASE_URL = "https://YOUR-REF.supabase.co";
window.SUPABASE_ANON_KEY = "YOUR-ANON-KEY";
```

Where to find these: Supabase Dashboard > Project Settings > API.

## 3) Run locally

Just open `index.html` with Live Server or a static file server, or double-click it.

## 4) Deploy free

### Netlify

- Add new site from Git.
- Set build command: none; publish directory: the repo root.
- Add environment variables if you prefer to generate `config.js` at build time; simplest is to commit `config.js` (no secrets beyond anon key).
- Optionally include `netlify.toml` (already provided) but it's not required.

### Vercel

- Import project.
- Framework preset: Other.
- Build command: none. Output: `/`.
- Optionally add env vars and generate `config.js` with a small build step; simplest is committing `config.js`.

## 5) Usage

- On first load, click "Sign in / Sign up" to create an account.
- After sign-up/sign-in, you'll be prompted to set your numeric passcode (stored hashed in DB).
- Back on the calculator, enter your passcode and press `=` to unlock chat.
- Select a user to start a DM.
- Paste a TikTok URL to send an embedded video message.

## Security notes

- Passcodes never stored in plaintext. Hashing is done server-side with `pgcrypto` via `set_passcode` RPC.
- RLS restricts messages to participants. Profiles are self-updatable; user list is served via SECURITY DEFINER RPC with safe fields only.

## Troubleshooting

- If TikTok embeds don't render, ensure the page can load `https://www.tiktok.com/embed.js` (not blocked by CSP).
- Realtime requires that your tables are enabled in Supabase Realtime settings.
- If email confirmation is enabled, verify your email before expecting a session.
