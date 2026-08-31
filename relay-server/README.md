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

Then, under the same pane, sign in: **Manta Account** → email and password, or
**Create one on this relay**. Accounts live on your relay and nowhere else. The
enrolment secret still works on its own — see "Accounts" below for when each is
the right one.

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
| `MANTA_RELAY_ACCOUNTS` | `shared` | `shared` or `per-user`. The deploy-time choice; see "Accounts". |
| `MANTA_RELAY_ALLOW_REGISTRATION` | inherits the enrolment secret | `open`, `disabled`, or unset. Only meaningful under `per-user`. |
| `MANTA_RELAY_MAX_HOSTS_PER_ACCOUNT` | `16` | Machines one account may claim. |
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

## Push notifications (iOS)

Optional, and off unless configured. Without it the phone still gets everything
— the app asks the desktop for what it missed when it reconnects — but only once
you open it. Push is what makes the phone tell you before you look.

The relay is where the APNs key lives because it is the always-on piece you run.
It cannot be the desktop: an APNs key is bound to one Apple team and bundle id,
so shipping it inside the desktop app would hand a copy to everyone who installs
a build. It cannot be the phone either. That leaves the relay.

**The relay still never sees a notification.** It is told which device to wake
and, once the encrypted payload lands, forwards bytes it cannot read — the same
position it holds for every other frame.

### What you need from Apple

A `.p8` auth key from developer.apple.com → Certificates, Identifiers & Profiles
→ Keys → ＋, with **Apple Push Notifications service (APNs)** ticked. Press
**Configure** beside it and choose **Sandbox & Production**.

That last step is not optional. A key left at the default Sandbox setting is
accepted by `api.sandbox.push.apple.com` and rejected by production with
`BadEnvironmentKeyInToken` — and TestFlight, like the App Store, is production.
The symptom is a push that reports no error anywhere and never arrives.

Apple lets you download the key once. The filename carries the Key ID:
`AuthKey_XXXXXXXXXX.p8`.

### Installing it

The container runs as a non-root user, and a bind mount hands it the file's real
uid and mode — so the key has to be owned by *that* user, not by you. Ask the
image which uid it is rather than assuming: `adduser -S` picks the first free
system id, so it can move when the base image does.

```bash
mkdir -p ~/manta-relay-apns
mv AuthKey_XXXXXXXXXX.p8 ~/manta-relay-apns/

uid=$(docker run --rm "$RELAY_IMAGE" id -u)
gid=$(docker run --rm "$RELAY_IMAGE" id -g)
sudo chown -R "$uid:$gid" ~/manta-relay-apns
sudo chmod 700 ~/manta-relay-apns
sudo chmod 600 ~/manta-relay-apns/AuthKey_XXXXXXXXXX.p8
```

Owning the directory as your login user and locking it to 700 is the obvious
first attempt and it fails: the container cannot *traverse* into a directory it
has no execute bit on, so the file's own mode never gets consulted. The error is
`Permission denied` on the directory, not the key.

After this, you can no longer read the key yourself without `sudo` — which is
the point.

Then in `.env`:

```bash
MANTA_RELAY_APNS_DIR=/home/YOU/manta-relay/apns
MANTA_RELAY_APNS_KEY_PATH=/apns/AuthKey_XXXXXXXXXX.p8   # path INSIDE the container
MANTA_RELAY_APNS_KEY_ID=XXXXXXXXXX
MANTA_RELAY_APNS_TEAM_ID=YYYYYYYYYY
MANTA_RELAY_APNS_TOPIC=cn.sh.manta.mobile               # the app's bundle id
```

Set all of them or none. On a partial set the relay refuses to start rather than
coming up quietly without push, because a misspelled variable and a deliberate
decision look identical from the outside.

The key is a path, never its contents. An environment value is visible in
`docker inspect`, in `/proc/<pid>/environ`, and in anything that dumps env on a
crash, and this particular secret can push arbitrary notifications to every
install of your app.

### Checking it before you need it

The relay logs `apns: ready` at startup with the topic and environment. To prove
the credentials end to end without a phone, send to a device token that cannot
exist:

- `BadDeviceToken` — the key, Key ID and Team ID are all correct. This is the
  answer you want; the token was the only wrong part.
- `InvalidProviderToken` — the key, Key ID or Team ID disagree with each other.
- `BadEnvironmentKeyInToken` — the key is Sandbox-only. Reissue it.

## Accounts

A relay serves one identity or one per person, and that is the operator's choice
at deploy time — `MANTA_RELAY_ACCOUNTS`:

| Value | What the relay is |
| --- | --- |
| unset / `shared` | **Default.** One identity for everyone who holds the enrolment secret. Nothing to sign in to, no machine list, no account endpoints. This is what every relay was before accounts existed. |
| `per-user` | Each person registers and gets their own identity, their own machines, and their own credentials. The enrolment secret stops being an identity and only gates who may register. |

Offering both was not on the table: a relay that accepted either would let one
careless click put someone on the shared identity, where their machines are
everyone's. So under `per-user` the shared grant is refused outright, and under
`shared` the account endpoints answer 404.

The desktop reads `GET /v1/desktop/auth/methods` before drawing the sign-in
screen, so it shows a password form only where one can be used. A relay that
predates that endpoint answers 404, which means `shared` — the correct answer.

**Signing in.** Under `per-user`: Settings → Manta Account, email and password.
**Create one on this relay** registers a new account; whether that is allowed is
`MANTA_RELAY_ALLOW_REGISTRATION`:

| Value | Who may register |
| --- | --- |
| unset | anyone holding the enrolment secret — the default wherever one is configured |
| `open` | anyone who can reach the origin |
| `disabled` | nobody — refused at startup under `per-user`, since it would accept no one at all |

`open` on a public origin also requires `MANTA_RELAY_TOKEN_SECRET`: an
ephemeral one invalidates every account's tokens on each restart, and with
signup open that is everybody's.

**Your machines.** Every desktop signed in to an account claims a host id — a
digest of its own key — the first time it asks for a relay token, and publishes
its hostname. Settings → Manta Account then lists every machine on the account,
which is online right now, and when each was last seen. Sign in to the same
relay from a second computer and it appears in the list on the first.

A host id belongs to exactly one account from the moment it is claimed. Another
account asking for a token for it is refused with `403
host_owned_by_another_account`, and so is a control leg presenting a token for
it. Removing a machine from the list retires its record and everything paired to
it; the id is then free to be claimed again.

**Taking a machine over from the legacy account.** On a relay upgraded from
before accounts, every host belongs to the environment identity — including
yours. Signing in with an account of your own would otherwise leave the relay
path dead with a 403 nobody sees, so the desktop hands the machine over
automatically using the enrolment secret it already has. That is the only
transfer the relay performs: a host is only ever moved *off* the legacy account,
and only for a caller who already holds the deployment's secret. The secret is
not a master key over other people's machines.

**Upgrading a relay that predates accounts.** Nothing to do — the default is
what it already was. On first start the environment identity
(`MANTA_RELAY_USER_ID`, `MANTA_RELAY_PROFILE_ID`, `MANTA_RELAY_ORG_ID`) becomes
a real account behind the scenes, every existing session and host record is
adopted with it, and the enrolment-secret grant keeps working exactly as before.
Setting `MANTA_RELAY_ACCOUNTS=per-user` later is the deliberate second step, and
it strands nothing: the hosts are all still on that account, and each desktop
takes its own back automatically as described above. Those three values must not
change either way: every paired desktop compares them byte for byte inside the
host proof, and a change is an undiagnosable 4401.

**State.** `auth-accounts.json` alongside `auth-sessions.json` and
`cell-state.json` in `MANTA_RELAY_DATA_DIR`, written 0600 with the same
fsync-and-rename discipline. Passwords are stored as scrypt hashes.

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

### The non-standard port, and why it is gone

This deployment ran on a non-standard port with a pinned certificate until the
ICP filing cleared. Both were workarounds for the same thing: the provider
hijacked 80 and 443 for the unfiled domain, and ACME needs one of them, so the
certificate could not renew and carried a hard 2026-11-17 expiry.

With the filing in place, 80 and 443 are usable and certificates are managed
again. What the move required, recorded because the next person hitting a
blocked port will need the same steps in reverse:

1. Confirm the block is gone **by name, and read the failure mode, not just the
   body**. With nothing yet listening on 80, the useful signal is which way the
   connection fails:

   | Result | Meaning |
   | --- | --- |
   | `Connection refused` | The packet reached the host. No filter answered — the block is gone. |
   | `Connection timed out` | Something dropped it. Usually the security group, not the filter. |
   | A redirect or notice page | A filter answered for a host that is not listening. Still blocked. |

   The filter answers _instead of_ the host, so it shows up even with no server
   running. That is what makes this test usable before the move rather than after.

2. `deploy/Caddyfile`: one block per name. The filing is for the registered
   domain and the relay has always been a subdomain of it, so the two split on
   the name they already had — no path matcher to keep in sync with the relay's
   route table, and so no way for a route added on one side only to answer HTML
   to a client expecting JSON.

3. `deploy/docker-compose.yml`: publish `80:80` and `443:443`, mount `./site`,
   and set `SITE_DOMAIN`. Drop `MANTA_RELAY_TLS_CERT_PATH` and the `./certs`
   mount once nothing loads a certificate from a file; that variable only feeds
   the expiry metric, which exists for proxies that cannot renew themselves.

4. `docker compose up -d`, then watch for `certificate obtained successfully`.
   Caddy serves the existing certificate until renewal, so a failure here is
   silent until it matters — do not skip the log check.

5. Update the desktop's Sign-in server and Relay address to drop the port, then
   Apply and restart. This signs the app out; that is expected, and the phone
   does not need to re-pair.

Two things the move taught that the configuration does not show:

**A certificate loaded from a file suppresses management for that name across the
whole Caddy instance.** Keeping the old port alive on the pinned certificate
through the migration therefore keeps the _new_ listener on it too — same serial,
same expiry — even though the new block asks for nothing. Forcing it with a
`tls { issuer acme }` on the other block does not work either: Caddy refuses the
config outright with `hostname appears in more than one automation policy`. The
name starts renewing itself only once no block loads a file for it, which in
practice means once the old port is retired. Retire it before the pinned
certificate expires, not after.

**Let's Encrypt validates from several vantage points, and issuance can fail on
some of them.** The error is `During secondary validation: DNS problem: query
timed out looking up A`. It is intermittent, not systemic: the zone resolves
4/4 from two international resolvers and from a domestic one, and two of the
three names here got certificates on the first pass — the apex needed one retry.
The relay's name simply lost the coin toss for several minutes.

Measure this before concluding anything about it, and pick resolvers this host
can actually reach. A DoH endpoint that is blocked from the querying machine
returns nothing, which looks exactly like a zone that cannot be resolved. Use a
known-good name as a reachability control on every resolver in the comparison;
without one, the result is a measurement of the network, not of the zone.

**Retrying costs an outage, which is the real constraint.** Caddy drops a
file-loaded certificate the moment the config stops naming it, and then serves
nothing for that name until ACME succeeds — so a failed attempt takes the relay
down for as long as it is left in place. It also falls back to Let's Encrypt's
staging endpoint after repeated failures, whose certificate no client trusts.
Issue out of band, with the pinned certificate still serving, and switch only
once the new one is in hand.

`deploy/certificate-bootstrap/` does exactly that, and is what currently runs on
the host. Caddy serves `/.well-known/acme-challenge/*` for the relay's name from
a webroot, certbot writes into it on a 20-minute timer, and only once a
certificate exists does the script seed Caddy's managed store and drop the `tls`
line — so the swap has no gap at all. It rolls back and keeps the pinned
certificate if the reload does not verify, and disables its own timer when done.

Twenty minutes is not arbitrary. Let's Encrypt allows five failed authorizations
per identifier per account per hour, and a tighter loop spends that budget
without improving the odds.

The script deliberately leaves `MANTA_RELAY_PUBLIC_URL` and the second listener
alone. Those sign the desktop out, so they are not something to do unattended.

What actually blocks issuance, when it blocks, is upstream of this fork:

```
DNSSEC: DNSKEY Missing: validation failure <relay.manta.sh.cn. A IN>:
key for validation cn. is marked as invalid because of a previous
No DNSKEY record [exceeded the maximum number of sends]
```

Let's Encrypt's resolver cannot fetch the DNSKEY for `cn.` and marks the whole
TLD bogus, so nothing under it resolves. Other attempts fail as a plain
`query timed out` instead. Either way it is intermittent, and it is not specific
to this zone: all three names here carry one A record, the same address, no
AAAA, no CNAME, and the zone is unsigned.

It is specifically the *remote* perspectives that fail. Production validates
from several vantage points and reports `During secondary validation`; staging
does not, and a staging issuance for the same name succeeds on the first attempt
while production is failing. That also dates the good windows — the two site
names were issued around midday and the relay's name was still failing at four
in the afternoon — which is the shape of cross-border congestion, not of a
misconfiguration.

So the remedy is the retry loop and nothing else. A staging issuance is the
cheap way to confirm that the webroot, the route and the primary perspective are
all fine before suspecting any of them.

### Registry secrets

Each registry is skipped when its secrets are absent, so configure only what
you use.

| Registry | Secrets |
| --- | --- |
| Docker Hub | `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `DOCKERHUB_REPO` (e.g. `you/manta-relay`) |
| Aliyun ACR | `ALIYUN_REGISTRY` (host only, e.g. `crpi-xxxx.cn-shanghai.personal.cr.aliyuncs.com`), `ALIYUN_USERNAME`, `ALIYUN_PASSWORD`, `ALIYUN_REPO` (e.g. `your-namespace/manta-relay`) |
| Tencent TCR | `TENCENT_REGISTRY` (e.g. `ccr.ccs.tencentyun.com`), `TENCENT_USERNAME`, `TENCENT_PASSWORD`, `TENCENT_REPO` |

Every `*_REPO` is `namespace/repository`, without the registry host and without
a scheme. A single segment is the mistake worth naming: it logs in fine and is
refused at push, so you find out after a full build. The workflow checks the
shape before building now.

Aliyun in particular creates nothing for you — the namespace and the repository
both have to exist in the ACR console first. Docker Hub creates personal
repositories on first push, but not organisation ones.

Run the workflow manually with **dry run** first — it builds and verifies both
architectures without pushing.

### Deploying a published image

Published images, `linux/amd64` and `linux/arm64`, same digest on both
registries because one build pushes to both:

| Registry | Image |
| --- | --- |
| Docker Hub | `paidaxingyo666/manta-relay` |
| Aliyun (Shanghai) | `crpi-b5cuqx1nkkudw599.cn-shanghai.personal.cr.aliyuncs.com/manta-relay/manta-relay` |

Set `RELAY_IMAGE` in `deploy/.env` and compose pulls instead of building:

```
RELAY_IMAGE=paidaxingyo666/manta-relay:1.1.0-dev.1
```

Accounts need 1.1.0 or newer; 1.0.0 predates them and answers 404 on every
account endpoint. Building from source always matches the checkout.

Pin a version rather than `:latest` — a relay that changes underneath a
restart is a bad surprise. Pin the digest if you want the exact bytes:

```
RELAY_IMAGE=paidaxingyo666/manta-relay@sha256:...
```

Left unset it builds from the checkout, which is what an unreleased commit
needs.

Verify what you pulled:

```bash
docker run --rm -p 8787:8787 \
  -e MANTA_RELAY_PUBLIC_URL=http://127.0.0.1:8787 \
  -e MANTA_RELAY_TOKEN_SECRET="$(openssl rand -base64 32)" \
  paidaxingyo666/manta-relay:1.1.0-dev.1
```

`curl localhost:8787/health` answers with the version, the commit it was built
from, and when — no shell access to the host required.

That command is a smoke test, not a deployment: it has no enrolment secret and
no TLS, so the relay refuses to enrol anyone. Use compose for the real thing.

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
