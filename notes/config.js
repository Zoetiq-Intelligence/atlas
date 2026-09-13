// Public by design. This file ships in a public repo.
//
// The anon/publishable key grants nothing on its own — row-level security is what
// protects the data, and it is keyed on auth.uid(). The key that must NEVER appear
// here or anywhere in this repo is the service_role key.

export const SUPABASE_URL = 'https://ymcewqdxtfxskyuizlqx.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_YNmR28xumQRSiyg_ZGILzw_b83LPViu';

// This Supabase project is shared with XENO's other systems, so these tables live in
// their own Postgres schema rather than cluttering `public`. PostgREST reaches a
// non-default schema through Accept-Profile / Content-Profile headers (see net.js),
// and the schema must also be added to Settings -> API -> Exposed schemas.
export const DB_SCHEMA = 'notes';

// GUIDE §8.2 — every path in this app is relative. GitHub Pages serves it at
// /atlas/notes/, not the domain root; one absolute path 404s only in production.
export const APP_VERSION = '1.5.0';
