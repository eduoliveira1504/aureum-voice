# 0036 — Production on a Hostinger VPS

- **Status:** accepted
- **Date:** 2026-10-27

## Context

Since 19/10 the beta ran on plan B: API, Postgres, Redis and MinIO on Eduardo's PC behind Tailscale
Funnel, media on LiveKit Cloud's free plan. On 26/10 voice stopped: the free plan's 5,000 participant
minutes for the month ran out, and the quota is a hard cap. The Oracle Always Free VM never came out
of "out of capacity". Eduardo decided on a paid VPS, Hostinger KVM 4 (4 vCPU, 16 GB RAM, Brazil
datacenter), split with his partners, so the beta can also open to more people later. This is the
only paid exception to the R$0 rule; everything that runs on it stays self-hosted and open source.

The technical address is a free DuckDNS name, `aureum-voice.duckdns.org`. A brand domain is a
separate decision and doesn't block the move. Block 3.18 in PHASE3.md has the step-by-step plan.

## Decision

### One host, one compose

- The whole stack runs on the VPS with docker compose: Caddy, API, Postgres, Redis, MinIO and
  LiveKit. Production gets its own file (`infra/docker-compose.prod.yml`); the dev compose doesn't
  change. Every service has `restart: unless-stopped` and a healthcheck.
- Secrets live only in the VPS `.env` (mode 600), never in git or in the chat. The JWT secret is the
  same as the PC's, so nobody is logged out by the move.
- Postgres, Redis and MinIO publish no ports at all; they're reachable only on the compose network.
  Images keep leaving through the API at `/api/media`, so MinIO is never exposed.

### Caddy in front, automatic HTTPS

- Caddy terminates TLS with Let's Encrypt certificates it gets and renews by itself (HTTP-01 on port
  80, then redirect to 443). It proxies the API and its WebSocket, and LiveKit's signaling (wss).
  Chosen over nginx + certbot because it's one small config file with no renewal cron.
- Subdomains under the DuckDNS name (`api.` and `live.`) are expected to resolve to the same IP;
  item 2 checks it. If they don't, LiveKit gets a second DuckDNS name.
- The API trusts `X-Forwarded-For` only from Caddy, as it did from Funnel, because the API port is
  never published.

### LiveKit self-hosted

- No `--dev`, new API key and secret, `use_external_ip: true`. The API hands out `LIVEKIT_URL`
  (public `wss://`) with the token and reaches LiveKit's server API on the internal
  `LIVEKIT_API_URL`, so the desktop app needs no update for the media move.
- Media ports: 7881/tcp (ICE over TCP, fallback for networks that block UDP) and one muxed UDP port,
  7882 (`rtc.udp_port`). LiveKit tells participants apart on that single port, so the container
  stays on the Docker bridge network: a wide range (e.g. 50000-60000) would mean thousands of
  NAT rules and a slow container start, and host networking would drop the container's isolation.
  It's also a single rule in each firewall. The trade-off is that a range spreads load over CPU
  cores a little better with hundreds of participants at once, which the beta isn't near; item 8
  measures the actual headroom.
- The built-in TURN stays off. It only helps on networks that block UDP *and* every TCP port but 443
  (7881/tcp already covers networks without UDP), and to help there it would have to answer
  TURN/TLS on 443, which Caddy owns: that needs a `turn.` subdomain and a Caddy build with the
  layer4 module. TURN on 3478 or 5349 is usually blocked on those same networks. Revisit if a tester
  on a corporate network can't join a call.

### Firewall

- Two layers: the Hostinger panel firewall (set by Eduardo) and `ufw` on the host. Both allow only
  22/tcp, 80/tcp, 443/tcp, 7881/tcp and LiveKit's UDP port(s).
- Docker writes its own iptables rules and bypasses `ufw` for published ports, so `ufw` alone isn't
  trusted: only Caddy and LiveKit publish ports, and the panel firewall is the outer guard.
- SSH by key only, root login off, a regular sudo user; fail2ban, unattended security upgrades,
  São Paulo time zone and Docker log rotation.

### Moving without breaking old apps

- The PC keeps running for a few days after the switch, with a "server moved" mode: a readable 503
  everywhere but health, the WebSocket closes with the same message, and `/convite/{code}` redirects
  (301) to the new address so links already sent keep working.
- 0.2.0-beta.8 changes the default address and moves apps still on the old Funnel address to the
  new one by themselves; custom addresses are left alone.
- Then, with Eduardo's OK, Funnel and LiveKit Cloud are turned off. PC backups are kept for 30 days.

## Consequences

- The project now has a fixed monthly cost (shared). Hostinger add-ons (paid backups, domains, extra
  IPs) are not used; backups are a daily `pg_dump` + MinIO copy kept 7 days on the VPS and copied to
  Eduardo's PC.
- No more participant-minute quota: voice capacity is bounded by the VPS's CPU and bandwidth, which
  item 8 measures with a small `lk load-test` run from another machine.
- Everything sits on one host, so a VPS outage takes the whole app down. Acceptable for the beta;
  the daily backup and a tested restore are the recovery path.
- Oracle stays an option to cut cost later: the same compose runs on any Linux host.
