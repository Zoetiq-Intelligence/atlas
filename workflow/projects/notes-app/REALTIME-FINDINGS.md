# Supabase Realtime — raw WebSocket protocol, verified against current docs (2026-09-16)

All of this is from the **official protocol spec** (`supabase/supabase` master, `apps/docs/content/guides/realtime/protocol.mdx`), the **realtime-js source** (master), the **auth-js source** (master), and **supabase/walrus** (the Postgres-changes engine). Where I could not verify something, it's flagged `⚠ UNVERIFIED`.

Runnable client file written to: `/tmp/claude-0/-home-claude/84372d69-fc9f-50cd-b80f-13e58b764083/scratchpad/supa-realtime.js` (syntax-checked + smoke-tested under Node; full source reproduced below).

---

## 1. WEBSOCKET CONNECTION

**URL (exact):**
```
wss://<PROJECT_REF>.supabase.co/realtime/v1/websocket?apikey=<API_KEY>&vsn=1.0.0
```
Self-hosted: `wss://<HOST>:<PORT>/socket/websocket?apikey=<API_KEY>`

Query params: `apikey` (required), `vsn` (`1.0.0` or `2.0.0`, **defaults to `1.0.0`**), `log_level` (server-side logging only).

**Protocol version string:** two exist right now.
- **`1.0.0`** — JSON **object** envelopes, text frames only. This is the server default *and* still what supabase-js ships (`src/lib/constants.ts`: `export const VSN: string = '1.0.0'`). **Use this.**
- **`2.0.0`** — JSON **array** envelopes `[join_ref, ref, topic, event, payload]`, plus two binary frame types (`0x03` USER_BROADCAST_PUSH, `0x04` USER_BROADCAST) used only for broadcast optimisation.

**Yes, it is the Phoenix channels protocol.** Topics are `realtime:<your-topic>`; heartbeats go to the reserved topic `phoenix`. Envelope for `vsn=1.0.0`:

```json
{ "topic": "realtime:presence-room", "event": "phx_join",
  "payload": { "config": { ... } }, "ref": "1", "join_ref": "1" }
```

So: **object form for 1.0.0, array form for 2.0.0** — you pick which by the `vsn` param. Both are current. Array form buys you nothing for a notes app; object form is easier to debug and is what the server assumes if you omit `vsn`.

Client→server events: `phx_join`, `phx_leave`, `heartbeat`, `access_token`, `broadcast`, `presence`.
Server→client: `phx_close`, `phx_error`, `phx_reply`, `system`, `broadcast`, `presence_state`, `presence_diff`, `postgres_changes`.

---

## 2. AUTH

**How RLS gets applied.** The `apikey` query param authenticates the *connection*. The **JWT** is what determines the Postgres role and `request.jwt.claims` used for RLS. Send it in **both** places:

1. **In the `phx_join` payload** — top-level `access_token` field, sibling of `config`:
   ```json
   { "config": {...}, "access_token": "eyJhbGciOi..." }
   ```
   Docs: *"`access_token`: Optional access token for authentication, **if not provided, the server will use the API key**."*
2. **Via the `access_token` event** — afterwards, to refresh without rejoining.

realtime-js does exactly this (`RealtimeChannel.subscribe()` merges `accessTokenPayload` into the join payload; `RealtimeClient._performAuth()` pushes an `access_token` event to every already-joined channel).

**Token expiry mid-connection.** Realtime caches the client's policy decision for the life of the connection: *"Client access policies are cached for the duration of the connection… Realtime updates the access policy cache when: a client connects and subscribes; **a new JWT is sent to Realtime from a client via the `access_token` message**."* And the consequence, verbatim: **"If a new JWT is never received on the Channel, the client will be disconnected when the JWT expires."**

Refresh message (vsn 1.0.0 object form):
```json
{ "topic": "realtime:notes:<uid>", "event": "access_token",
  "payload": { "access_token": "<new jwt>" },
  "ref": "12", "join_ref": "1" }
```
**There is no reply on success.** On failure the server emits a `system` error and **closes the channel**. realtime-js calls `setAuth()` on *every heartbeat* (25 s) — i.e. it re-checks the token every 25 s and only pushes when it changed. I've replicated that with a 30 s tick (auth-js `AUTO_REFRESH_TICK_DURATION_MS`) and a 90 s pre-expiry margin (auth-js `EXPIRY_MARGIN_MS`).

If you join with an already-expired token, the `phx_join` gets `status:"error"` with `response.reason = "InvalidJWTExpiration: Token has expired 300 seconds ago"`. If it expires while joined, you get a `system` error containing `"Token has expired"` followed by `phx_close`.

**⚠ Important gotcha:** *"Tokens with the `sb_*` prefix are **silently ignored** by the server"* as `access_token`. So a new-style publishable key (`sb_publishable_…`) is fine as the `apikey` **query param** but is **not** a valid `access_token` — it's not a JWT.

**Does the anon/publishable key alone work?** Yes, for public/anon-readable streams: with no `access_token`, the server falls back to the API key and you get the `anon` role, so `anon` RLS policies apply. But:
- For **user-scoped RLS** (`auth.uid()`) you **must** send a user JWT. There is no way around this.
- **Public Realtime connections are capped at 24 hours** unless upgraded to user-level auth (from the new-API-keys migration guide).
- **Private channels** (`config.private: true`) require a JWT with `role` and `exp` claims — missing claims yields the system error `Fields \`role\` and \`exp\` are required in JWT`.

Refreshing without supabase-js: `POST {SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, header `apikey: <key>`, body `{"refresh_token": "..."}` — taken from auth-js `GoTrueClient._refreshAccessToken()`. (This endpoint is not in the *Realtime* docs; verified from auth-js source, not from a spec page.)

---

## 3. SUBSCRIBING TO POSTGRES CHANGES

**Full literal `phx_join` (vsn 1.0.0) for your case:**

```json
{
  "topic": "realtime:notes-sync",
  "event": "phx_join",
  "ref": "1",
  "join_ref": "1",
  "payload": {
    "config": {
      "broadcast": { "ack": false, "self": false },
      "presence": { "enabled": false, "key": "" },
      "private": false,
      "postgres_changes": [
        { "event": "*", "schema": "notes", "table": "note",
          "filter": "user_id=eq.8b1f0c9e-3f2a-4a11-9d8e-6c2a7f5b0d31" },
        { "event": "*", "schema": "notes", "table": "folder",
          "filter": "user_id=eq.8b1f0c9e-3f2a-4a11-9d8e-6c2a7f5b0d31" }
      ]
    },
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...."
  }
}
```

Fields: `event` ∈ `INSERT|UPDATE|DELETE|*`; `schema` (or `*`); `table` (or `*`); `filter` (optional); `select` (optional array of column names — new, reduces payload, requires explicit schema+table, PK always included).

**Filters.** Format is PostgREST-style `column=operator.value`, e.g. `id=eq.1`, `title=like.%foo%`.
Supported operators (verbatim from the spec): **`eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `in`, `like`, `ilike`, `is`, `match`, `imatch`, `isdistinct`**.
- Negate any operator with `not.` → `id=not.eq.5`, `status=not.in.(draft,archived)`.
- Multiple conditions joined by commas = **AND**: `id=gt.0,id=lt.100`.
- Reserved chars `,` `(` `)` inside a value must be double-quoted PostgREST-style: `name=eq."a,b"`.
- **DELETE can only be filtered if the table has `replica identity full`.**

**NON-PUBLIC SCHEMA — yes, it works.** There is an explicit "Private schemas" section: *"Postgres Changes works out of the box for tables in the `public` schema. You can listen to tables in your private schemas by granting table `SELECT` permissions to the database role found in your access token."*

The `schema` field takes the **bare schema name only**: `"schema": "notes", "table": "note"`. Never `"notes.note"`.

**Server-side SQL required:**

```sql
-- 1. The subscribing role must be able to reach the schema and read the tables.
--    The docs only mention GRANT SELECT; USAGE on the schema is *also* required
--    in Postgres and is the #1 reason non-public schemas "silently" produce
--    empty payloads.  (This USAGE line is my addition, not in the docs.)
grant usage on schema notes to authenticated;
grant select on notes.note, notes.folder to authenticated;

-- 2. RLS (strongly advised — without it any granted role reads everything).
alter table notes.note   enable row level security;
alter table notes.folder enable row level security;
create policy "own notes" on notes.note
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own folders" on notes.folder
  for select to authenticated using (user_id = (select auth.uid()));

-- 3. Add to the publication.  THIS IS REQUIRED.  Schema-qualify the table.
alter publication supabase_realtime add table notes.note, notes.folder;
-- If supabase_realtime doesn't exist yet:
--   create publication supabase_realtime;   (then the ALTER above)

-- 4. old_record on UPDATE/DELETE, and filterable DELETEs.
alter table notes.note   replica identity full;
alter table notes.folder replica identity full;
```

- **Publication: required.** No publication entry → no events. The `system` error for this is *"Subscription insert failed (table/publication missing)"*, which the server **retries every 5–10 s** and which does **not** close the channel — so it looks like silence, not an error.
- **REPLICA IDENTITY: required for `old_record`.** Default (`DEFAULT` = primary key only) gives you `old_record: {"id": 46}` and nothing else. `full` gives the whole previous row. Caution from the docs: **RLS is not applied to DELETE statements** — with `replica identity full`, the full deleted row goes to *every* subscriber of that table. For a private-schema notes table that is a real leak vector; scope it with a filter and keep RLS on SELECT tight, or use Broadcast (see §6).
- **The table must have a primary key**, else walrus emits `errors: "Error 400: Bad Request, no primary key"`.

---

## 4. RECEIVING EVENTS

**Exact wire shape** (vsn 1.0.0 object form; the spec's example is 2.0.0 array form — same payload):

```json
{
  "topic": "realtime:notes-sync",
  "event": "postgres_changes",
  "ref": null,
  "payload": {
    "ids": [104868189],
    "data": {
      "schema": "notes",
      "table": "note",
      "commit_timestamp": "2026-09-16T00:22:40.877Z",
      "type": "UPDATE",
      "columns": [
        { "name": "id", "type": "int8" },
        { "name": "created_at", "type": "timestamptz" },
        { "name": "text", "type": "text" }
      ],
      "record":     { "id": 46, "text": "content", "created_at": "2026-09-03T09:32:55+00:00" },
      "old_record": { "id": 46 },
      "errors": null
    }
  }
}
```

**The wire names are `record`, `old_record`, `type`, `commit_timestamp`, `columns`, `errors`.**
`eventType`, `new` and `old` **do not exist on the wire** — they are a client-side rename done inside `RealtimeChannel._trigger()` in supabase-js. Hand-rolling, you will see `type`/`record`/`old_record`. This trips up almost everyone porting from the SDK.

**Correlation.** The `phx_join` reply hands back ids, **positionally aligned with the array you sent**:

```json
{ "topic":"realtime:notes-sync", "event":"phx_reply", "ref":"1",
  "payload": { "status":"ok",
    "response": { "postgres_changes": [
      { "id": 106243155, "event":"*", "schema":"notes", "table":"note" },
      { "id": 106243156, "event":"*", "schema":"notes", "table":"folder" }
    ]}}}
```

Store `response.postgres_changes[i].id` against your i-th binding, then match incoming `payload.ids.includes(bindingId)`. supabase-js additionally verifies that `event/schema/table/filter` of reply\[i] equal binding\[i] and hard-errors with *"mismatch between server and client bindings for postgres changes"* if not. The spec says: *"A mismatch means inconsistent server/client state — tear down and rejoin."* My client does both.

Subscription-live confirmation arrives as a separate `system` message: `{"message":"Subscribed to PostgreSQL","status":"ok","extension":"postgres_changes","channel":"..."}`. **A `phx_reply` status "ok" does NOT mean the Postgres subscription is live** — wait for this.

---

## 5. KEEPALIVE AND RECONNECTION

**Heartbeat:** `{"topic":"phoenix","event":"heartbeat","payload":{},"ref":"<n>"}` — note the reserved topic `phoenix`, **no** `join_ref`. Spec: *"should be sent at least every 25 seconds to avoid a connection timeout."* realtime-js uses exactly `HEARTBEAT_INTERVAL: 25000`.

Miss one and the server times the connection out. On the client side, the correct pattern (copied from realtime-js `sendHeartbeat()`) is: keep the outstanding `ref`; if the next tick arrives and the previous ref was never acked by a `phx_reply` on topic `phoenix`, **force-close the socket yourself and reconnect**. Do not wait for `onclose` — on mobile a dead socket stays `readyState === 1` indefinitely. This is the single most important piece for a PWA.

**Reconnection semantics (documented):**
- `phx_error` (channel process died, empty payload) → rejoin with exponential backoff.
- `phx_close` after a rate-limit `system` error → throttle first, then rejoin.
- `phx_close` after a token `system` error → refresh the token first.
- `phx_close` with no preceding system error → clean close; only rejoin if unexpected.
- **Backoff guidance:** the JS client uses `[1000, 2000, 5000, 10000]` ms, capped at 10 s, configurable via `reconnectAfterMs`. (Confirmed in `RealtimeClient.ts`: `RECONNECT_INTERVALS = [1000,2000,5000,10000]`, `DEFAULT_RECONNECT_FALLBACK = 10000`.) Add jitter yourself — the SDK doesn't.
- **Join errors carry a backoff on the server**: *"The server adds a backoff delay before replying, so avoid aggressive client-side retry loops on join errors."* Join error codes and what to do: `InvalidJWTExpiration` → refresh + rejoin; `MalformedJWT`/`JwtSignatureError`/`Unauthorized` → **do not retry**; `ConnectionRateLimitReached`/`ClientJoinRateLimitReached`/`ChannelRateLimitReached` → back off; `InitializingProjectConnection`/`IncreaseConnectionPool`/`DatabaseLackOfConnections`/`UnableToConnectToProject` → exponential backoff; `TopicNameRequired`/`TenantNotFound`/`RealtimeDisabledForTenant`/`RealtimeDisabledForConfiguration` → **do not retry**; `RealtimeRestarting` → retry with backoff.

**Free-tier limits that matter** (Realtime Limits page):

| | Free | Pro |
|---|---|---|
| Concurrent connections | **200** | 500 |
| Messages per second | **100** | 500 |
| Channel joins per second | **100** | 500 |
| Channels per connection | **100** | 100 |
| Broadcast payload size | **256 KB** | 3,000 KB |
| Postgres change payload size | **1,024 KB** | 1,024 KB |
| Broadcast replay retention | 72 h | 72 h |

For 1 user × 2 devices, none of these bind. The one that could bite you in dev is **channel joins per second: 100** if a reconnect loop misfires, and **messages/sec 100** — exceeding it disconnects you with `tenant_events`. Refusal messages on join: `too_many_channels`, `too_many_connections`, `too_many_joins`. Also remember the **24-hour cap on unauthenticated (publishable-key-only) connections**.

---

## 6. BROADCAST vs POSTGRES_CHANGES

| | `postgres_changes` | Broadcast from database (`realtime.send` / `realtime.broadcast_changes` in a trigger) |
|---|---|---|
| **Path** | WAL → walrus → **per-subscriber RLS check** → fan-out | Trigger → insert into `realtime.messages` → logical replication → fan-out, **one auth check at join time** |
| **Latency** | Sub-second normally, but every event is authorised **once per subscriber** and processed **on a single thread to preserve order** — so it degrades with subscriber count, and bigger compute does *not* help | Lower; message is built once and fanned out. Supabase's own blog cites "reduction in latency of sent messages" |
| **Setup cost** | Publication + grants + replica identity. No SQL functions | RLS policy on `realtime.messages` + a trigger function + private channel. More SQL, but no publication/replica-identity fiddling |
| **RLS** | Row-level, per event, automatically. **Except DELETE — RLS is not applied**, so `old_record` of a deleted row goes to all subscribers of that table | Topic-level, checked once at join, via RLS policies on `realtime.messages` (`realtime.topic()` helper). You control payload contents, so you decide what leaks |
| **Payload** | Whole row (or `select`-narrowed). Hits the 1 MB cliff | Whatever your trigger builds — you can send a thin `{op, id, updated_at}` notification |
| **Non-public schema** | Needs `grant usage`+`grant select` on `notes.*` to `authenticated` | Trigger is `security definer`; the channel auth only touches `realtime.messages`. **Your `notes` schema needs no grants to `authenticated` at all** |
| **Supabase's own stance** | *"`postgres_changes` should be avoided due to scalability limitations"* and *"Don't use `postgres_changes` for new applications"* (official `examples/prompts/use-realtime.md`) | *"Use `broadcast` with database triggers for all database change notifications"* |

### My pick for 1 user / 2 devices: **Broadcast from the database.**

Reasons, in order of weight:
1. **The `notes` schema problem evaporates.** postgres_changes forces you to `GRANT SELECT` on `notes.note` / `notes.folder` to `authenticated` *project-wide* just so Realtime's walrus can re-read the row as that role. That's a real widening of your attack surface for a schema you deliberately kept out of `public`. The trigger approach is `SECURITY DEFINER` and needs zero grants on `notes`.
2. **You control the payload.** Note bodies are exactly the kind of `text` column that blows through the 1 MB postgres-changes limit — and the failure mode there is silent and ugly (see §7). Broadcast a thin `{op, id, updated_at, origin}` and let the device pull the row over PostgREST; you get a smaller, faster, more predictable message.
3. **Topic = `notes:<user_id>` is a perfect fan-out shape.** No per-row `filter=` string, no filter-operator edge cases, no chance of a client subscribing to a broader filter than its RLS allows.
4. **Deletes are safe.** postgres_changes broadcasts deleted rows to all table subscribers with no RLS; a topic-scoped broadcast doesn't.
5. It's what Supabase tells you to build for anything new.

Honest counterweight: for *literally* two subscribers, `postgres_changes` is perfectly fast and is ~15 lines of SQL less. If you want the shortest path to a working prototype, start with postgres_changes and migrate. But the non-public-schema grant is the thing that tips it for me.

**SQL for the recommended path:**

```sql
-- A. Realtime Authorization: who may join topic 'notes:<uid>'.
create policy "own notes topic"
on realtime.messages
for select to authenticated
using (
  realtime.topic() = 'notes:' || (select auth.uid())::text
  and realtime.messages.extension = 'broadcast'
);
-- (RLS is already enabled on realtime.messages; you cannot create tables there.)

-- B. Trigger function. SECURITY DEFINER, so no grants needed on `notes`.
create or replace function notes.broadcast_note_change()
returns trigger
security definer set search_path = ''
language plpgsql as $$
begin
  perform realtime.send(
    jsonb_build_object(                      -- payload
      'op',         tg_op,
      'id',         coalesce(new.id, old.id),
      'updated_at', coalesce(new.updated_at, old.updated_at),
      'origin',     coalesce(new.origin_device, old.origin_device)
    ),
    tg_op,                                   -- event name: INSERT | UPDATE | DELETE
    'notes:' || coalesce(new.user_id, old.user_id)::text,   -- topic
    true                                     -- private
  );
  return null;
end $$;

create trigger note_broadcast
after insert or update or delete on notes.note
for each row execute function notes.broadcast_note_change();
-- repeat for notes.folder
```

Then join with `config.private: true` and listen for `broadcast` events named `INSERT`/`UPDATE`/`DELETE`.

**⚠ UNVERIFIED — argument order of `realtime.send`.** The docs page shows `realtime.send(payload jsonb, event text, topic text, private boolean)`; Supabase's own official prompt file `examples/prompts/use-realtime.md` shows the calls as `realtime.send(topic, event, payload, false)`. **These contradict each other.** I could not reach the function's SQL definition (the `supabase/realtime` repo's migrations weren't fetchable from here). The docs page is the more likely correct one and is what I used above, but **confirm on your project before relying on it**:
```sql
select pg_get_function_arguments(oid) from pg_proc
 where proname in ('send','broadcast_changes') and pronamespace = 'realtime'::regnamespace;
```

**⚠ UNVERIFIED — payload shape of `realtime.broadcast_changes`.** Its argument list is documented (`topic, event, operation, table, schema, NEW, OLD`) but **no Supabase page shows the resulting JSON the client receives**. I checked the protocol spec, the broadcast guide, the subscribing-to-changes guide, the launch blog and the DEV crosspost — none of them print it. The widely-observed shape is `{operation, record, old_record, schema, table}` under `payload`, but I am not asserting that. Using `realtime.send` with a `jsonb_build_object` you wrote yourself sidesteps this entirely, which is another reason I recommend it.

Other broadcast facts worth knowing:
- **Public/private must match.** *"A public broadcast only reaches public channels and a private broadcast only reaches private channels."* Database broadcasts default to **private**. A mismatch = total silence, no error.
- Messages sent from the DB are stored in `realtime.messages` and **deleted after 3 days** (daily partitions).
- Broadcast replay exists (`config.broadcast.replay: {since, limit}`), 72 h retention, max 25 messages per request — genuinely useful for "device was offline, catch up" in a 2-device sync app. Replayed messages arrive with `meta.replayed: true`.
- `realtime.send_binary()` exists for `bytea` payloads.

---

## 7. GOTCHAS

1. **`record`/`old_record`/`type` vs `new`/`old`/`eventType`.** Covered in §4. The SDK names are not the wire names.
2. **The 1 MB payload cliff is silent and destructive.** When a postgres_changes payload exceeds `max_record_bytes` (default 1,048,576), walrus does **not** drop the event — it strips `record`/`old_record` down to *"only fields with a value size ≤ 64 bytes"* and sets `errors: "Error 413: Payload Too Large"`. You get an event with a mangled row. For a notes app with long bodies this **will** happen. **Always check `data.errors !== null` before trusting `record`.**
3. **Other `errors` values** (from `supabase/walrus`): `"Error 400: Bad Request, no primary key"` (table has no PK) and `"Error 401: Unauthorized"` (the subscribing role can't select the PK columns — the classic symptom of a non-public schema with missing `GRANT USAGE`/`GRANT SELECT`; you get events with empty `record`).
4. **Column-level visibility.** walrus filters columns by what the role can see, so a column you didn't grant simply won't appear in `record`. Not an error, just missing data.
5. **There is no `errors` *topic*.** Errors arrive on four channels only: a WS close frame before join; `phx_reply` with `status:"error"`; a `system` event; `phx_error`. Note the asymmetry: **channel-level `system` errors are always followed by `phx_close`** (channel is dead), while **`postgres_changes` `system` errors leave the channel open** (broadcast/presence keep working, the PG subscription is just degraded — server retries every 5–10 s). Your UI needs to distinguish these.
6. **`UnknownErrorOnChannel` breaks the error format.** Every other join error is `"<Code>: <message>"`; that one arrives as the bare string `"Unknown Error on Channel"`. Don't assume your `split(': ')` works.
7. **Self-echo.** postgres_changes has **no** self-suppression — you always receive your own writes back. Database-originated broadcasts likewise always reach the writer's device (the `broadcast.self` flag only affects *client-sent* broadcasts). Put an `origin_device` column / field in the payload and filter, or make your merge idempotent on `updated_at`. For a 2-device sync app this is not optional; without it you get an echo loop the moment the remote apply re-triggers a local write.
8. **Broadcast failures are silent by default.** *"When `config.broadcast.ack` is `false` (the default), all push failures — including size violations and RLS write denials — are silently dropped. RLS denials are always silent regardless of `ack`."* If client-sent broadcasts vanish, that's why. With `ack: true` you get `{"status":"error","response":{"error":"payload_size_exceeded"}}`.
9. **Delivery is at-most-once.** Events can be lost (network drop, tenant rate-limit disconnect via `tenant_events`). Do **not** treat the stream as the source of truth — reconcile on reconnect by refetching rows changed since your last `commit_timestamp`. This is the single biggest design consequence for a sync app.
10. **Ordering.** postgres_changes preserves commit order *because* it's processed on a single thread — which is also why it doesn't scale. Broadcast makes **no documented ordering guarantee** across messages; with `realtime.send` from a trigger, order in practice follows the WAL, but I would not build on it. Carry a monotonic `updated_at`/version and apply last-writer-wins.
11. **DELETE + RLS.** Repeating because it's the worst one: *"RLS policies are not applied to `DELETE` statements."* With `replica identity full`, deleting a note sends the entire row to **every** subscriber of that table, regardless of ownership.
12. **`phx_reply` ok ≠ subscribed.** Wait for the `system` / `"Subscribed to PostgreSQL"` message before believing the Postgres stream is live.
13. **Dead sockets on mobile.** `readyState` stays OPEN long after a phone backgrounds. Heartbeat-timeout self-close + `visibilitychange` + `online` listeners are mandatory in a PWA. Included below.
14. **`sb_*` keys as `access_token` are silently ignored** (§2).
15. **Private channels need "Allow public access" disabled** in Realtime Settings for `private: true` to actually be enforced.
16. **Topic name `realtime` is reserved** — you can't use it as a channel name.
17. **Postgres changes throughput scales with subscriber count, not write rate** — 100 users on one table = 100 auth checks per write. Irrelevant for you, fatal at ~3,000 subscribers (docs' own threshold for switching to Broadcast).

---

## THE CLIENT

Zero dependencies, `vsn=1.0.0` object envelopes, broadcast-primary with a postgres_changes path included. Syntax-checked with `node --check`; the dispatch/correlation logic was smoke-tested (confirmed it accepts `ids:[42]` for a binding with server id 42 and correctly ignores `ids:[99]`).

```js
/* =============================================================================
 * supa-realtime.js — zero-dependency Supabase Realtime client (raw WebSocket)
 * Protocol: Phoenix channels, Supabase Realtime vsn=1.0.0 (JSON object frames)
 * Docs: https://supabase.com/docs/guides/realtime/protocol
 * ========================================================================== */

'use strict';

// --- tunables, matching supabase/realtime-js defaults --------------------
const HEARTBEAT_MS        = 25000;              // docs: "at least every 25 seconds"
const RECONNECT_BACKOFF   = [1000, 2000, 5000, 10000]; // realtime-js RECONNECT_INTERVALS
const RECONNECT_MAX_MS    = 10000;
const JOIN_TIMEOUT_MS     = 10000;              // realtime-js DEFAULT_TIMEOUT
const TOKEN_EXPIRY_MARGIN = 90000;              // auth-js EXPIRY_MARGIN_MS (90s)
const TOKEN_TICK_MS       = 30000;              // auth-js AUTO_REFRESH_TICK_DURATION_MS

/** Decode a JWT payload without any dependency. Returns {} on garbage. */
function jwtClaims(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(
      atob(b64).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
    ));
  } catch { return {}; }
}

/* =============================================================================
 * SessionStore — minimal replacement for supabase-js auth session handling.
 * POST {SUPABASE_URL}/auth/v1/token?grant_type=refresh_token
 * (endpoint + 90s margin taken from supabase/auth-js GoTrueClient).
 * ========================================================================== */
class SessionStore {
  constructor({ supabaseUrl, apikey, storageKey = 'sb-session' }) {
    this.supabaseUrl = supabaseUrl.replace(/\/$/, '');
    this.apikey = apikey;
    this.storageKey = storageKey;
    this.session = null;
    this._inflight = null;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) this.session = JSON.parse(raw);
    } catch { /* private mode / disabled storage */ }
  }

  set(session) {
    // Normalise: server returns expires_in; we store an absolute ms deadline.
    if (session && !session.expires_at_ms) {
      session.expires_at_ms = session.expires_at
        ? session.expires_at * 1000
        : Date.now() + (session.expires_in || 3600) * 1000;
    }
    this.session = session;
    try { localStorage.setItem(this.storageKey, JSON.stringify(session)); } catch {}
  }

  /** Returns a *valid* access token, refreshing if within the expiry margin. */
  async getToken() {
    if (!this.session) return null;
    const msLeft = this.session.expires_at_ms - Date.now();
    if (msLeft > TOKEN_EXPIRY_MARGIN) return this.session.access_token;
    await this.refresh();
    return this.session ? this.session.access_token : null;
  }

  async refresh() {
    if (this._inflight) return this._inflight;       // de-dupe concurrent refreshes
    if (!this.session || !this.session.refresh_token) return null;
    this._inflight = (async () => {
      const res = await fetch(
        `${this.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: this.apikey },
          body: JSON.stringify({ refresh_token: this.session.refresh_token }),
        }
      );
      if (!res.ok) {
        // 400 here = refresh token revoked/rotated away. The user must sign in
        // again; do NOT retry in a loop, you'll just burn rate limit.
        this.session = null;
        try { localStorage.removeItem(this.storageKey); } catch {}
        throw new Error('refresh failed: ' + res.status);
      }
      this.set(await res.json());
      return this.session;
    })().finally(() => { this._inflight = null; });
    return this._inflight;
  }
}

/* =============================================================================
 * RealtimeSocket — one WebSocket, N channels.
 * ========================================================================== */
class RealtimeSocket {
  constructor({ supabaseUrl, apikey, session, log }) {
    this.host = supabaseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    this.apikey = apikey;
    this.session = session;
    this.log = log || (() => {});

    this.ws = null;
    this.ref = 0;
    this.channels = new Map();   // topic -> channel state
    this.tries = 0;
    this.pendingHeartbeatRef = null;
    this.heartbeatTimer = null;
    this.tokenTimer = null;
    this.reconnectTimer = null;
    this.closedByUs = false;
    this.currentToken = null;
  }

  _nextRef() { return String(++this.ref); }

  // -- 1. CONNECTION --------------------------------------------------------
  // wss://<PROJECT_REF>.supabase.co/realtime/v1/websocket?apikey=<KEY>&vsn=1.0.0
  // vsn=1.0.0 -> JSON *object* envelopes {topic,event,payload,ref,join_ref}
  // vsn=2.0.0 -> JSON *array*  envelopes [join_ref,ref,topic,event,payload]
  // 1.0.0 is the server default and what supabase-js still ships; use it.
  url() {
    const p = new URLSearchParams({ apikey: this.apikey, vsn: '1.0.0' });
    return `wss://${this.host}/realtime/v1/websocket?${p}`;
  }

  async connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    this.closedByUs = false;
    this.currentToken = await this.session.getToken().catch(() => null);

    const ws = this.ws = new WebSocket(this.url());

    ws.onopen = () => {
      this.log('info', 'socket open');
      this.tries = 0;
      this._startHeartbeat();
      this._startTokenLoop();
      for (const ch of this.channels.values()) this._joinChannel(ch);
    };

    ws.onmessage = (ev) => {
      // vsn=1.0.0 => every frame is a JSON text frame in object form.
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      this._dispatch(msg);
    };

    ws.onerror = (e) => this.log('error', 'socket error', e);

    ws.onclose = (e) => {
      this.log('warn', `socket closed ${e.code} ${e.reason}`);
      this._stopTimers();
      for (const ch of this.channels.values()) { ch.state = 'closed'; ch.pgIds = []; }
      if (!this.closedByUs) this._scheduleReconnect();
    };
  }

  disconnect() {
    this.closedByUs = true;
    this._stopTimers();
    if (this.ws) { try { this.ws.close(1000, 'client disconnect'); } catch {} }
    this.ws = null;
  }

  _isOpen() { return this.ws && this.ws.readyState === 1; }

  _send(msg) {
    if (!this._isOpen()) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  // -- 5. HEARTBEAT ---------------------------------------------------------
  // {topic:'phoenix', event:'heartbeat', payload:{}, ref:'N'}   (no join_ref)
  // If a reply never lands before the next tick, the connection is dead
  // (phone slept, NAT dropped the flow) -> force-close and reconnect.
  // onclose alone is NOT reliable on mobile.
  _startHeartbeat() {
    clearInterval(this.heartbeatTimer);
    this.pendingHeartbeatRef = null;
    this.heartbeatTimer = setInterval(() => {
      if (!this._isOpen()) return;
      if (this.pendingHeartbeatRef) {
        this.log('warn', 'heartbeat timeout — forcing reconnect');
        this.pendingHeartbeatRef = null;
        try { this.ws.close(1000, 'heartbeat timeout'); } catch {}
        return;
      }
      this.pendingHeartbeatRef = this._nextRef();
      this._send({ topic: 'phoenix', event: 'heartbeat', payload: {},
                   ref: this.pendingHeartbeatRef });
    }, HEARTBEAT_MS);
  }

  // -- 2. AUTH REFRESH ------------------------------------------------------
  // The server caches the RLS decision for the lifetime of the JWT. If a fresh
  // JWT never arrives, Realtime DISCONNECTS the channel when the old expires.
  // Push a new token in-band with `access_token`; no reply on success.
  _startTokenLoop() {
    clearInterval(this.tokenTimer);
    this.tokenTimer = setInterval(() => this._maybeRefreshToken(), TOKEN_TICK_MS);
  }

  async _maybeRefreshToken() {
    let token;
    try { token = await this.session.getToken(); }
    catch (e) { this.log('error', 'token refresh failed', e); return; }
    if (!token || token === this.currentToken) return;
    this.currentToken = token;
    for (const ch of this.channels.values()) {
      ch.params.access_token = token;                 // so future rejoins use it
      if (ch.state === 'joined') {
        this._send({ topic: ch.topic, event: 'access_token',
                     payload: { access_token: token },
                     ref: this._nextRef(), join_ref: ch.joinRef });
      }
    }
    this.log('info', 'access_token pushed');
  }

  // -- RECONNECT ------------------------------------------------------------
  _scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    const base = RECONNECT_BACKOFF[this.tries] ?? RECONNECT_MAX_MS;
    const delay = base + Math.floor(Math.random() * 500);  // jitter
    this.tries++;
    this.log('info', `reconnecting in ${delay}ms (try ${this.tries})`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  _stopTimers() {
    clearInterval(this.heartbeatTimer);
    clearInterval(this.tokenTimer);
    this.heartbeatTimer = this.tokenTimer = null;
    this.pendingHeartbeatRef = null;
  }

  // -- CHANNELS -------------------------------------------------------------
  /** @param {string} topic bare topic, e.g. 'notes:<user-id>' (NO 'realtime:' prefix) */
  channel(topic, config = {}) {
    const full = `realtime:${topic}`;
    if (this.channels.has(full)) return this.channels.get(full).api;

    const ch = {
      topic: full,
      state: 'closed',
      joinRef: null,
      joinTimer: null,
      pgIds: [],                       // server-assigned postgres_changes ids
      pgBindings: config.postgres_changes || [],
      handlers: { broadcast: new Map(), pg: [], status: [] },
      params: {
        config: {
          broadcast: { ack: false, self: false, ...(config.broadcast || {}) },
          presence:  { enabled: false, key: '', ...(config.presence || {}) },
          postgres_changes: config.postgres_changes || [],
          private: config.private !== false,   // default to PRIVATE
        },
      },
    };

    ch.api = {
      onBroadcast: (event, cb) => {
        if (!ch.handlers.broadcast.has(event)) ch.handlers.broadcast.set(event, []);
        ch.handlers.broadcast.get(event).push(cb);
        return ch.api;
      },
      onPostgresChange: (cb) => { ch.handlers.pg.push(cb); return ch.api; },
      onStatus: (cb) => { ch.handlers.status.push(cb); return ch.api; },
      send: (event, payload) => this._send({
        topic: ch.topic, event: 'broadcast',
        payload: { type: 'broadcast', event, payload },
        ref: this._nextRef(), join_ref: ch.joinRef,
      }),
      leave: () => {
        this._send({ topic: ch.topic, event: 'phx_leave', payload: {},
                     ref: this._nextRef(), join_ref: ch.joinRef });
        this.channels.delete(full);
      },
    };

    this.channels.set(full, ch);
    if (this._isOpen()) this._joinChannel(ch);
    return ch.api;
  }

  _joinChannel(ch) {
    ch.joinRef = this._nextRef();
    ch.state = 'joining';
    if (this.currentToken) ch.params.access_token = this.currentToken;
    this._send({
      topic: ch.topic, event: 'phx_join', payload: ch.params,
      ref: ch.joinRef, join_ref: ch.joinRef,
    });
    clearTimeout(ch.joinTimer);
    ch.joinTimer = setTimeout(() => {
      if (ch.state === 'joining') {
        this.log('warn', `join timeout ${ch.topic}`);
        this._emit(ch, 'status', { status: 'error', reason: 'join timeout' });
        try { this.ws.close(1000, 'join timeout'); } catch {}
      }
    }, JOIN_TIMEOUT_MS);
  }

  _emit(ch, kind, arg) {
    for (const cb of ch.handlers[kind]) {
      try { cb(arg); } catch (e) { this.log('error', 'handler threw', e); }
    }
  }

  // -- 4. INBOUND DISPATCH --------------------------------------------------
  _dispatch(msg) {
    const { topic, event, payload, ref } = msg;

    // heartbeat ack
    if (topic === 'phoenix' && event === 'phx_reply') {
      if (ref === this.pendingHeartbeatRef) this.pendingHeartbeatRef = null;
      return;
    }

    const ch = this.channels.get(topic);
    if (!ch) return;

    switch (event) {
      case 'phx_reply': {
        if (ref !== ch.joinRef) return;              // reply to some other push
        clearTimeout(ch.joinTimer);
        if (payload.status === 'ok') {
          ch.state = 'joined';
          // Correlate postgres_changes: the reply array is POSITIONALLY
          // aligned with what we sent in phx_join.config. Each entry gets a
          // server-assigned numeric `id`; incoming events carry `ids:[...]`.
          const server = payload.response && payload.response.postgres_changes;
          if (Array.isArray(server)) {
            ch.pgIds = server.map(s => s.id);
            const mismatch = server.some((s, i) => {
              const c = ch.pgBindings[i];
              return !c || s.event !== c.event || s.schema !== c.schema ||
                     s.table !== c.table ||
                     (s.filter || undefined) !== (c.filter || undefined);
            });
            if (mismatch) {
              // supabase-js hard-errors here; stale client/server state.
              this.log('error', 'postgres_changes binding mismatch — rejoining');
              ch.api.leave(); return;
            }
          }
          this._emit(ch, 'status', { status: 'joined', pgIds: ch.pgIds });
        } else {
          // reason is "<ErrorCode>: <human message>", e.g.
          // "InvalidJWTExpiration: Token has expired 300 seconds ago"
          const reason = (payload.response && payload.response.reason) || 'unknown';
          ch.state = 'errored';
          this._emit(ch, 'status', { status: 'error', reason });
          if (/InvalidJWTExpiration|expired/i.test(reason)) {
            this.session.refresh().then(() => this._maybeRefreshToken()).catch(() => {});
          }
          // MalformedJWT / JwtSignatureError / Unauthorized / TenantNotFound:
          // do NOT retry — surface to the UI.
        }
        return;
      }

      case 'system': {
        // extension:'postgres_changes' -> subscription status, channel STAYS open
        // extension:'system'           -> channel-level, always followed by phx_close
        this._emit(ch, 'status', {
          status: payload.status === 'ok' ? 'pg_ok' : 'pg_error',
          extension: payload.extension, message: payload.message,
        });
        if (payload.status === 'error' && /Token has expired/i.test(payload.message || '')) {
          this.session.refresh().catch(() => {});
        }
        return;
      }

      case 'phx_error':                 // channel process died server-side
        ch.state = 'errored';
        this._emit(ch, 'status', { status: 'error', reason: 'phx_error' });
        if (this._isOpen()) setTimeout(() => this._joinChannel(ch),
                                       RECONNECT_BACKOFF[Math.min(this.tries++, 3)]);
        return;

      case 'phx_close':
        ch.state = 'closed';
        this._emit(ch, 'status', { status: 'closed' });
        return;

      case 'broadcast': {
        // payload = {type:'broadcast', event, payload, meta?:{id, replayed?}}
        const list = [
          ...(ch.handlers.broadcast.get(payload.event) || []),
          ...(ch.handlers.broadcast.get('*') || []),
        ];
        for (const cb of list) {
          try { cb(payload.payload, payload); } catch (e) { this.log('error', 'handler threw', e); }
        }
        return;
      }

      case 'postgres_changes': {
        // payload = { ids:[...], data:{schema,table,commit_timestamp,type,
        //             columns,record,old_record,errors} }
        // NOTE: `record`/`old_record`/`type` are the WIRE names. supabase-js
        // renames them to new/old/eventType — that rename is client-side only.
        if (!payload.ids || !payload.ids.some(id => ch.pgIds.includes(id))) return;
        for (const cb of ch.handlers.pg) {
          try { cb(payload.data, payload.ids); } catch (e) { this.log('error', 'handler threw', e); }
        }
        return;
      }

      default:
        return;   // presence_state, presence_diff, etc.
    }
  }
}

/* =============================================================================
 * APPLICATION LAYER — 1 user, 2 devices, notes.note / notes.folder
 * Recommended: Broadcast from the database (trigger -> realtime.send),
 * on a PRIVATE channel topic scoped to the user id.
 * ========================================================================== */

const SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co';
const SUPABASE_KEY = 'sb_publishable_XXXXXXXXXXXX';   // or legacy anon JWT
const DEVICE_ID = (() => {                            // stable per-install id
  let d; try { d = localStorage.getItem('device-id'); } catch {}
  if (!d) { d = crypto.randomUUID(); try { localStorage.setItem('device-id', d); } catch {} }
  return d;
})();

function startNoteSync(session /* SessionStore, already signed in */) {
  const socket = new RealtimeSocket({
    supabaseUrl: SUPABASE_URL, apikey: SUPABASE_KEY, session,
    log: (lvl, m, x) => console[lvl === 'error' ? 'error' : 'log']('[rt]', m, x ?? ''),
  });

  const userId = jwtClaims(session.session.access_token).sub;

  // Private channel: RLS on realtime.messages decides who may join.
  const ch = socket.channel(`notes:${userId}`, { private: true });

  ch.onStatus(s => console.log('[rt] channel', s));

  ch.onBroadcast('*', (body, envelope) => {
    // body is exactly what the SQL trigger put in realtime.send()'s payload.
    // Suppress our own writes (DB broadcasts always self-echo).
    if (body.origin === DEVICE_ID) return;
    const replayed = envelope.meta && envelope.meta.replayed;
    applyRemoteChange(body, { replayed });
  });

  socket.connect();

  // PWA essentials: mobile browsers freeze the socket on background and it
  // dies silently while readyState still reads OPEN.
  addEventListener('online',  () => socket.connect());
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !socket._isOpen()) socket.connect();
  });

  return { socket, ch };
}

function applyRemoteChange(body /* {op,id,updated_at,origin,...} */, meta) {
  // Idempotent merge: compare updated_at/version against the local copy, then
  // fetch the full row over PostgREST if the payload is a thin notification.
  // Delivery is AT-MOST-ONCE: on reconnect, also refetch everything changed
  // since your last seen commit/updated_at. Do not trust the stream alone.
  console.log('remote change', body, meta);
}

/* ---------------------------------------------------------------------------
 * ALTERNATIVE: postgres_changes on the non-public `notes` schema.
 * Note `schema: 'notes'` — bare schema name, never 'notes.note'.
 * ------------------------------------------------------------------------ */
function startPgChangesSync(session, userId) {
  const socket = new RealtimeSocket({
    supabaseUrl: SUPABASE_URL, apikey: SUPABASE_KEY, session,
  });
  const ch = socket.channel('notes-pg', {
    private: false,                       // public and private both support PG changes
    postgres_changes: [
      { event: '*', schema: 'notes', table: 'note',   filter: `user_id=eq.${userId}` },
      { event: '*', schema: 'notes', table: 'folder', filter: `user_id=eq.${userId}` },
    ],
  });
  ch.onPostgresChange((data) => {
    // data.errors is NOT null when the row was truncated (413) or the role
    // could not read the PK (401). Check it before trusting data.record.
    if (data.errors) { console.warn('degraded event', data.errors); return; }
    console.log(data.type, data.schema + '.' + data.table, data.record, data.old_record);
  });
  socket.connect();
  return { socket, ch };
}
```

---

## Sources

- [Realtime Protocol | Supabase Docs](https://supabase.com/docs/guides/realtime/protocol) — URL, vsn, envelopes, every message shape, error codes, backoff, access_token
- [Postgres Changes | Supabase Docs](https://supabase.com/docs/guides/realtime/postgres-changes) — publication SQL, replica identity, private schemas, filters, `select`, scaling
- [Realtime Authorization | Supabase Docs](https://supabase.com/docs/guides/realtime/authorization) — `realtime.messages` RLS, policy cache, disconnect-on-expiry
- [Realtime Limits | Supabase Docs](https://supabase.com/docs/guides/realtime/limits) — free-tier table, `tenant_events`, 64-byte truncation
- [Subscribing to Database Changes | Supabase Docs](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes) — trigger + `broadcast_changes` recipe
- [Broadcast | Supabase Docs](https://supabase.com/docs/guides/realtime/broadcast) — `realtime.send`, public/private matching, replay, 3-day retention
- [supabase/realtime-js `src/lib/constants.ts`](https://raw.githubusercontent.com/supabase/realtime-js/master/src/lib/constants.ts) — `VSN = '1.0.0'`
- [supabase/realtime-js `src/RealtimeClient.ts`](https://raw.githubusercontent.com/supabase/realtime-js/master/src/RealtimeClient.ts) — heartbeat 25000, backoff `[1000,2000,5000,10000]`, `_performAuth`
- [supabase/realtime-js `src/RealtimeChannel.ts`](https://raw.githubusercontent.com/supabase/realtime-js/master/src/RealtimeChannel.ts) — join payload, positional id correlation, new/old rename
- [supabase/auth-js `src/GoTrueClient.ts`](https://raw.githubusercontent.com/supabase/auth-js/master/src/GoTrueClient.ts) — refresh endpoint, 90 s margin, 30 s tick
- [supabase/walrus README](https://github.com/supabase/walrus/blob/master/README.md) — `errors` values (400/401/413), 64-byte truncation, per-subscriber RLS, DELETE caveat
- [supabase/supabase `examples/prompts/use-realtime.md`](https://raw.githubusercontent.com/supabase/supabase/master/examples/prompts/use-realtime.md) — official "don't use postgres_changes for new apps" guidance (and the conflicting `realtime.send` arg order)
- [API keys | Supabase Docs](https://supabase.com/docs/guides/getting-started/api-keys) and [Migrating to publishable and secret API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys) — publishable keys are not JWTs, 24 h public connection cap, anon/service_role deprecated end of 2026
- [Realtime: Broadcast from Database (blog)](https://supabase.com/blog/realtime-broadcast-from-database) — latency rationale
- [All the ways to react to changes in Supabase (Sequin)](https://blog.sequinstream.com/all-the-ways-to-react-to-changes-in-supabase/) — at-most-once delivery

## Could NOT verify
1. **`realtime.send` argument order** — docs say `(payload, event, topic, private)`, Supabase's own prompt file uses `(topic, event, payload, private)`. Check with `pg_get_function_arguments` before shipping.
2. **`realtime.broadcast_changes` resulting JSON payload shape** — documented nowhere I could find; only the argument list is published. Use `realtime.send` with an explicit `jsonb_build_object` to avoid depending on it.
3. **`GRANT USAGE ON SCHEMA notes`** — the docs only mention `GRANT SELECT` on the table. USAGE is a Postgres requirement and I'm confident it's needed, but it is my inference, not a documented step.
4. **Measured latency numbers** — Supabase publishes no latency SLO for either mechanism. "Sub-second" is achievable for both but is not a documented guarantee; benchmark on your own project.
5. Whether a **non-JWT publishable key as `apikey`** with no `access_token` maps to the `anon` role for postgres_changes RLS — strongly implied by the API-keys doc ("publishable key maps to the `anon` role when no user is signed in") but not stated in a Realtime-specific context.