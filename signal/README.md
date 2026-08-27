# signal

A tiny WebSocket relay for WebRTC handshake blobs (SDP/ICE) between a host and joiners
in a room; it never sees game traffic. Run it locally with `bun run signal` (listens on
`PORT`, default 5200), and deploy it anywhere that runs Bun with WebSockets — e.g.
`fly launch` from inside `signal/`. The client reads the server's URL from
`VITE_SIGNAL_URL` (wired up in task C2).
