# Manta relay (self-hosted)

A relay that pairs the Manta desktop app with the Manta mobile app when the two
cannot reach each other directly. It is a byte pipe with a credential
authority — it never sees plaintext, because the desktop and the phone run their
own end-to-end encryption on top of every frame it forwards.

Point the desktop at it and the hosted relay is out of the picture entirely.

## What it replaces

The hosted service is three things behind one origin, and this implements all
three in one process:

| Surface | Endpoints | Job |
| --- | --- | --- |
| auth | `/v1/desktop/auth/*` | Signs the desktop in, issues relay tokens |
| director | `/v1/assign`, `/v1/resolve` | Tells a peer which cell to dial |
| cell | `/v1/host/control`, `/v1/host/data/{connId}`, `/v1/connect/{relayHostId}` | Moves the bytes |

Running them together is not a shortcut: it keeps the director's assignment
epoch and the cell's idea of it trivially consistent, which is otherwise a
distributed-state problem for a deployment that has exactly one cell.

## Requirements

- **A public hostname and a real TLS certificate.** The phone forces `wss://`
  and Android will not trust a private CA, so a self-signed certificate cannot
  work. The compose file below gets one from Let's Encrypt automatically.
- **The origin must match exactly.** `MANTA_RELAY_PUBLIC_URL` is signed into
  every host challenge and compared byte for byte. A trailing slash, a port that
  differs from what the desktop dialled, or `http` where the client used `https`
  all fail the proof with no useful error on either side.
- Node 20+ if you run it without Docker.

## Deploy with Docker

```bash
cd deploy
cp .env.example .env
$EDITOR .env          # set RELAY_DOMAIN and MANTA_RELAY_TOKEN_SECRET
docker compose up -d
```

Caddy terminates TLS on 443 and proxies to the relay, which is not published on
the host at all. The relay container runs unprivileged with a read-only root
filesystem; the only writable path is its state volume.

## Deploy as a service

```bash
git clone <this repo> /opt/manta-relay && cd /opt/manta-relay/relay-server

# Dev dependencies first: the compiler is one of them, so `--omit=dev` here
# leaves `npm run build` with no tsc. Prune after the build, not before.
npm ci && npm run build && npm prune --omit=dev

useradd --system --home /var/lib/manta-relay manta
install -d -o manta -g manta -m 0750 /var/lib/manta-relay
install -o root -g manta -m 0640 /dev/null /etc/manta-relay.env
$EDITOR /etc/manta-relay.env          # see deploy/.env.example

cp deploy/manta-relay.service /etc/systemd/system/
systemctl enable --now manta-relay
```

Secrets go in `/etc/manta-relay.env`, not in the unit file: `systemctl show`
prints `Environment=` values to any local user.

Put a TLS terminator in front of it. If you use something other than Caddy, set
`MANTA_RELAY_TRUSTED_PROXIES` to the proxy's address — see below.

## Point the desktop at it

Settings → Advanced → Manta Cloud → **Self-hosted server** → **Configure endpoints**:

| Field | Value |
| --- | --- |
| Sign-in server | `https://relay.example.com` |
| Relay address | `https://relay.example.com` |
| OAuth client ID | `manta-desktop` |
| Enrolment secret | the value of `MANTA_RELAY_ENROLLMENT_SECRET` |

Include the port if the relay is not on 443 — the origin is signed into every
host challenge byte for byte, so `https://host` and `https://host:9443` are
different identities and a mismatch fails the proof with nothing useful on
either side.

Applying signs the app out and relaunches it, which is deliberate: a session
issued by one deployment is meaningless to another.

**No browser opens.** With a secret configured the desktop exchanges it for a
session directly. The authorization-code flow exists for a hosted service with
a real identity provider and a human to sign in; a single-user self-hosted relay
has neither, so bouncing a code through the browser would prove nothing the
secret has not already proven — and it would put the secret in a URL, which is
where browser history and proxy logs keep things. The code flow still works and
is used whenever no secret is set.

The saved secret is never rendered back into the settings field. Leaving it
blank means "unchanged"; clearing every field returns the app to the official
endpoints.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `MANTA_RELAY_PUBLIC_URL` | — | **Required.** Bare origin, no path. Signed into every challenge. |
| `MANTA_RELAY_TOKEN_SECRET` | random | Set it. Without it every restart mints a new one, breaking relay tokens until they refresh. |
| `MANTA_RELAY_ENROLLMENT_SECRET` | — | **Required unless the origin is loopback.** The desktop sends it in the session-exchange body. |
| `MANTA_RELAY_DATA_DIR` | — | Set it. Without it, credentials are memory-only and every phone re-pairs after a restart. |
| `MANTA_RELAY_TRUSTED_PROXIES` | `` | Who may set `X-Forwarded-For`. `loopback`, `private`, `docker`, or a CIDR list. |
| `MANTA_RELAY_METRICS_TOKEN` | — | Bearer token for `/metrics`. Unset means the endpoint 404s. |
| `MANTA_RELAY_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`. |
| `MANTA_RELAY_TLS_CERT_PATH` | — | Certificate to watch. Only useful where the proxy cannot renew on its own. |
| `MANTA_RELAY_ORG_ID` | `` | Leave empty unless the desktop profile genuinely has an org — compared byte for byte in the proof. |
| `MANTA_RELAY_MAX_DEVICES` | `16` | Phones per desktop. |
| `MANTA_RELAY_MAX_SESSIONS` | `64` | Desktops on this cell. |
| `MANTA_RELAY_MAX_CONNS_PER_HOST` | `8` | Concurrent phone connections per desktop. Cannot exceed 8 — see below. |
| `MANTA_RELAY_SHUTDOWN_GRACE_MS` | `5000` | How long peers get to migrate on SIGTERM. |

Rate limits are `MANTA_RELAY_{PHONE,HTTP,AUTH,CONTROL}_{BURST,RATE}`; the
defaults are sized for a household, not a public service. Everything else is in
`src/config.ts`, and out-of-range values fail at startup rather than silently
breaking pairing later.

Several of those ranges are not preferences — they are the client's parser. The
desktop validates control frames with strict zod schemas, so a `graceMs` past an
hour or a ninth entry in `pendingConns` does not degrade anything: it makes the
*whole message* unparseable, and the desktop then waits out its own timeout with
no error to show anyone. That is why the ceilings are enforced at startup.

### About `MANTA_RELAY_TRUSTED_PROXIES`

Rate limiting is only as good as the address it buckets on.

- Unset, directly exposed: correct. The socket's peer address is used.
- Unset, behind a proxy: **every client shares one bucket** — the proxy's. One
  phone reconnecting in a loop locks out everyone.
- Set to a range that includes untrusted peers: a client sets its own
  `X-Forwarded-For` and every limit becomes decorative.

Set it to the address of your proxy and nothing else. Startup warns when the
origin is `https` and this is empty, which is almost always the mistake.

## Observability

- `GET /health` — unauthenticated, `{"ok":true}`, `503` while draining so a load
  balancer pulls the relay out of rotation before it stops accepting.
- `GET /metrics` — Prometheus text, behind `MANTA_RELAY_METRICS_TOKEN`. Counters
  for phone connects and rejections (by reason), host rejections (by reason),
  rate-limit refusals (by surface), credential installs, bytes forwarded;
  gauges for live sessions, pairs, and stored hosts.
- Logs are JSON lines. Credential-shaped fields are redacted by field name, so
  a debug-level log of a control message does not print a resume token.

The line to look for when pairing fails is `host.proof.rejected`: it prints the
origin, epoch, and identity the cell used, which is enough to see which of them
disagrees with the desktop.

## Operating notes

- **Restarts are cheap.** Credentials, invites, and the rotation ledger are
  persisted, and the desktop stays signed in. Phones do not re-pair.
- **SIGTERM drains.** Connected phones are told `4503` — the code that makes
  them re-resolve — rather than being dropped into a bare `1006`, and new
  connections are refused for the same reason. A second signal exits at once.
- **The state file is a credential store.** It holds hashes, not tokens —
  resume credentials, auth sessions, and control resume secrets are all stored
  as digests, because the cell only ever compares them. Losing it unpairs every
  phone, so back up `cell-state.json`.
- **A corrupt snapshot stops the relay** rather than being read as empty state.
  Empty state is not a safe default here: the next flush would write it back and
  unpair every phone with nothing in the logs to explain it. The file is moved
  to `cell-state.json.corrupt` and the next start is clean.

## Scope and limits

Single cell, single user. Multi-region assignment, cross-cell migration, and
multi-tenant accounts are deliberately out — that is what the hosted service is
for. `/v1/regions` returns 404 on purpose so the desktop skips region probing.

Because the E2EE layer requires exact frame ordering with no reorder buffer, a
future multi-instance setup needs per-connection stickiness; you cannot simply
put two of these behind a round-robin.

### When the proxy cannot renew

Automatic renewal needs port 80 or 443. If those are unavailable — a mainland
Chinese host serving an unfiled domain has both hijacked, for instance — the
certificate has a fixed end date and no automatic path past it, and nothing in
the stack notices until it lapses.

Two things make that survivable. Pin the certificate in the Caddyfile with
`tls <cert> <key>` so Caddy stops retrying a challenge it cannot win, and set
`MANTA_RELAY_TLS_CERT_PATH` so the relay reports the remaining days as
`manta_relay_certificate_expires_in_days` and logs `tls.certificate_expiring`
under 30 days. Serving TLS on a non-standard port is enough to avoid a
Host-header filter, which inspects cleartext HTTP on every port but leaves TLS
alone; it does not help with issuance, which still needs 80 or 443. The durable
fixes are to resolve whatever blocks those ports, or to move issuance to a
DNS-01 challenge.

### Moving back to 443 once issuance works again

The non-standard port and the pinned certificate are both workarounds for
blocked ports. When that block lifts — an ICP filing completing, a firewall
opening — undo them in this order. The origin is signed into every host
challenge, so the relay and the desktop must change together or the proof
fails with nothing useful on either side.

1. Confirm the block is actually gone, by domain and not just by IP. A filter
   that inspects the Host header answers a bare IP normally while still
   hijacking the name:

   ```bash
   curl -sI --resolve relay.example.com:80:<ip> http://relay.example.com/ | head -1
   ```

   A 200 or a redirect to your own site means it is clear. A redirect to the
   provider's notice page means it is not.

2. In `deploy/Caddyfile`, change the site address from `{$RELAY_DOMAIN}:9443`
   to `{$RELAY_DOMAIN}`, drop the `tls` line so Caddy manages the certificate
   again, and drop the `auto_https disable_redirects` global block.

3. In `deploy/docker-compose.yml`, publish `80:80` and `443:443` instead of the
   non-standard port, drop `MANTA_RELAY_TLS_CERT_PATH` and the `./certs` mount,
   and set `RELAY_PORT=443` in `.env` — or remove the port from
   `MANTA_RELAY_PUBLIC_URL` entirely.

4. `docker compose up -d`, then watch for `certificate obtained successfully`.
   Caddy reuses the existing certificate until renewal, so a failure here is
   silent until it matters — do not skip the log check.

5. Update the desktop's Sign-in server and Relay address to drop the port, then
   Apply and restart. This signs the app out; that is expected, and the phone
   does not need to re-pair.

6. Remove the firewall rule for the non-standard port.

`deploy/certs/` can be deleted once step 4 succeeds.

Known gaps, honestly:

- Rate limits are per-process and in-memory. A restart forgets them.
- Base images are tracked by tag (`node:22-alpine`, `caddy:2-alpine`) rather
  than pinned by digest, so a rebuild picks up upstream security fixes — and
  also upstream changes you did not ask for. Pin the digests if you need
  reproducible builds more than you need automatic patching.
- Auth sessions are capped at 64 and pruned oldest-first. That is a household
  assumption, not a policy engine.
- No tracing, and no alerting rules ship with the metrics.

## Development

```bash
npm ci
npm run check        # typecheck + tests
npm run dev          # watch mode
```

The test suite boots the real stack through `createRelay`, so the rate limiters,
the upgrade path, and the shutdown sequence are exercised as they run in
production. The host proof is answered by the desktop's *own* implementation,
imported from `../src/main/runtime/relay/relay-host-proof` — if the transcript
changes on either side, these tests fail before a user ever does.

What that suite actually pins down:

- Full pairing: sign-in → relay token → assignment → control handshake →
  invite → phone connect → bytes both ways with the binary flag preserved.
- Frames the phone sends **before** the desktop attaches are buffered and
  replayed in order. The phone starts its E2EE handshake in the same microtask
  it receives `relay-hello`; dropping that frame deadlocks pairing permanently,
  and a test that attaches first would never notice.
- Lease rebind reuses the session — same generation, pending connections
  returned — and a wrong resume secret is refused with `4401`, the one code the
  client has a recovery path for.
- A `relayHostId` not derived from the host key is refused, as is a second
  `host-hello` on one socket.
- Credential lifecycle: grace generation stays usable, repeated installs replay
  byte for byte, versions never go backwards across a revoke, unknown
  authorization modes are refused rather than defaulted.
- Limits actually fire: `4429` for phones, `429` with `Retry-After` for HTTP,
  `rate_limited` on the control leg, and the invite/device/pending ceilings.
- Restart durability against the real on-disk snapshot, including that tokens
  are stored hashed.
- Every frame the cell emits is parsed by the clients' **own** zod schemas —
  the desktop's for the control leg, the phone's for `relay-hello`. They are
  `.strict()`, so an extra diagnostic field is not ignored: the client discards
  the whole message and waits out its own timeout with nothing to show. That
  check found three such bugs, including a `retryAfterMs` on a rate-limit
  refusal that would have cost the phone the very code telling it to back off.
- Hostile input survives. Everything on these endpoints runs in a socket
  callback, where a throw is `uncaughtException` and the process is gone — so
  the suite sends the frames that actually reach a coercion: a body that parses
  to `null` (a *successful* parse, so the try/catch around it does not help), a
  value whose `toString` is not callable, a negative `previousGeneration` that
  reaches `writeBigUInt64BE`, a malformed percent-escape in an upgrade path, an
  oversized body, and a forged data leg that must not strand the pending
  connection the genuine one is about to claim.
- One host cannot reach into another's state: `__proto__` as a device id or a
  request id is refused, and a second host sending it does not affect the first.
- A lease rebind survives the old control leg closing first — the race that
  would otherwise kick every phone and then leave the rebind nothing to resume.
- Shutdown completes even when a peer completes the WebSocket handshake and
  then stops reading, which otherwise holds `server.close()` for 30 seconds.
- A corrupt state file stops the relay instead of being read as empty state.

Several of these were verified by reverting the fix and watching the test fail,
which is the only way to know a regression test is not decorative.

Most of what this section covers came from an adversarial review of a version
that already passed 75 tests. The reviewable surface and the tested surface are
not the same thing: the suite's own `signIn()` helper *was* the open-enrolment
hole, used as the happy path in every other test, so no test could ever have
found it.
