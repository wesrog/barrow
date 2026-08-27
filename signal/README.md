# signal

A tiny WebSocket relay between a host and joiners in a room. All game traffic rides it
as opaque `relay` messages (lockstep inputs at 25 Hz plus one snapshot per join — tiny),
so no WebRTC/NAT traversal is ever needed. Run it locally with `bun run signal` (listens on
`PORT`, default 5200). Production runs on Fly.io as `barrow-signal`
(wss://barrow-signal.fly.dev, sjc, auto-stop when idle) — redeploy with `fly deploy`
from inside `signal/`. The client reads the server's URL from `VITE_SIGNAL_URL`
(defaults to ws://localhost:5200; the Pages workflow sets the production URL).
