# Operations

How to run the stack on a local network and what to check when something does not work.

## Services

Two services must be up: the LiveKit server (Docker container) and the Next.js app.

```bash
# LiveKit (create once, then `docker start livekit-dev` on later days)
docker run -d --name livekit-dev --restart unless-stopped \
  -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
  livekit/livekit-server --dev --bind 0.0.0.0 --node-ip <LAN-IP>

# Next.js
npm run dev
```

To change LiveKit flags (for example a new `--node-ip`), remove the container with `docker rm -f livekit-dev` and create it again; `docker restart` does not pick up new flags.

`devkey` / `secret` are the credentials built into LiveKit's `--dev` mode. Do not expose a `--dev` LiveKit server to the internet.

## Phone access on the LAN

Three settings must point at the laptop's Wi-Fi LAN IP (not `localhost`, not a VPN address):

1. `ALLOWED_DEV_ORIGINS` in `.env.local`. Next.js 16 blocks cross-origin requests to dev assets; without the LAN IP, phones load the listener page but its JavaScript returns 403 and the buttons do nothing.
2. LiveKit's `--node-ip`, so it advertises a reachable address in its ICE candidates.
3. `NEXT_PUBLIC_LIVEKIT_URL` and `NEXT_PUBLIC_LISTENER_BASE_URL` in `.env.local`.

Restart the Next.js dev server after changing any of them; `NEXT_PUBLIC_` values and `next.config.ts` are not hot-reloaded. If the IP changes, all three need updating. If phones still cannot connect, allow inbound traffic on ports 3000, 7880, 7881 and 7882 in the laptop's firewall.

## Running a session

1. **Open room**: connects to LiveKit and shows the QR code and listener link. No translation runs and nothing is billed. Listeners who join see "waiting for the speaker".
2. **Start translation**: opens the OpenAI session and publishes the translated audio to the room. Billing starts.
3. **Stop translation**: closes the translation session but keeps the room open, so listeners stay connected. Use it between speakers, during breaks and during Q&A.
4. **Close room**: tears everything down, finalises telemetry and writes the session report to `benchmarks/`.

Event ID, target language and "Capture source" lock once the room is open, because the room name is derived from the event ID and language. The microphone locks while translating. The output device, monitor choice and broadcast toggle can change at any time.

Without `NEXT_PUBLIC_LIVEKIT_URL`, the flow collapses to Start and Stop on a single laptop.

## Audio devices

- Device names appear only after the browser has microphone permission. Click **Detect devices** to trigger the prompt before starting.
- The output device can change mid-session (`setSinkId`). Safari does not support `setSinkId`, so the output selector is disabled there.
- **Raw audio** disables the browser's echo cancellation, noise suppression and automatic gain control. Turn it on for clean line-level inputs, such as a feed from a mixing desk or a virtual audio cable, where that processing causes pumping or clipping.
- **Broadcast to tab audio** keeps a second copy of the translation playing on the system default device, so a screen share in Zoom, Meet or OBS still carries the translation while the operator monitors on separate headphones.

## Telemetry panel

Updated once a second while a session is live: uptime, connection state, token expiry countdown (amber under 10 minutes, red under 5), first-token latency (last, p50, p95), seconds since the last transcript activity, disconnects and errors, current and peak listeners, estimated cost and a log of recent events. **Mark moment** bookmarks the current second in the report, which helps when pairing what the speaker said with what listeners heard.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `OPENAI_API_KEY is not configured on the server` | Key missing from `.env.local` | Add it and restart the dev server |
| `LIVEKIT_API_KEY / LIVEKIT_API_SECRET not configured` | LiveKit values missing | Fill them in, or use single-laptop mode |
| Operator shows "Live" but there is no audio | Monitor set to Mute, tab muted or wrong output device | Check the Monitor setting, tab volume and OS output |
| Phone loads the listener page but buttons do nothing | Dev-origin protection returns 403 for the JavaScript | Add the LAN IP to `ALLOWED_DEV_ORIGINS` and restart |
| Phone cannot reach the listener URL | Different Wi-Fi, or the QR code points at `localhost` | Set `NEXT_PUBLIC_LISTENER_BASE_URL` to the LAN IP |
| Phone shows "Live" but stays silent | iOS blocks autoplay until a tap | The Listen button handles this; check headphones and volume |
| Translated audio is choppy | Wi-Fi congestion, or WebRTC fell back to TCP on 7881 | Move closer to the access point or use a less congested 5 GHz channel |
| `docker: port is already allocated` | An old LiveKit container still holds 7880 | `docker rm -f livekit-dev` and create it again |

## Cost discipline

The OpenAI session bills for as long as it is open, whether or not anyone is speaking. Stop translation whenever nobody is presenting. "Capture source" adds a second billed transcription stream; leave it off unless the operator needs to see the source transcript. Cross-check the on-screen estimate against the provider's usage dashboard after each session.
