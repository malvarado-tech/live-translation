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

1. **Open room**: connects to LiveKit and shows the event QR code (one code for every language) with a projector view. No translation runs and nothing is billed. Listeners who join see "Broadcast not started; audio starts automatically".
2. **Start translation** (Space): opens the OpenAI session and publishes the translated audio to the room. Billing starts. **Start original audio** publishes the speaker's audio as is, for listeners of the source language, and bills nothing.
3. **Pause** (Space): closes the translation session but keeps the room open, so listeners stay connected and see "Paused between speakers". Use it between speakers, during breaks and during Q&A.
4. **End session**: asks for confirmation, tells listeners the session ended, tears everything down and writes the session report to `benchmarks/`.

Event ID, title, language and channel type are set in Setup and lock once the room is open, because the room name is derived from the event ID and language. **Change input** applies at the next start. The monitor output, monitor choice and the tab-audio copy are under "Session details and audio routing" and can change at any time.

Each language runs in its own operator tab with the same event ID; "Add language" opens one with the event prefilled. Every tab shows the other languages as strips or rows with their state, listener count and response time, read from the room server every 5 seconds. Their meters and transcripts are only available in their own tab.

Without `NEXT_PUBLIC_LIVEKIT_URL`, the flow collapses to Start and Stop on a single laptop.

## Views and themes

**Desk** shows the input and each language as vertical channel strips with a tally light, ladder meter, response time, listener count and on-air time, with transcript lanes below. **Rows** shows the same channels as horizontal rows, one alert slot with its fix, and the monitored transcript at reading size. Light is the default theme; **Night** suits dark rooms. View and theme are under **Settings** at the end of the session bar, and both choices are remembered on the device. Listeners choose their own view, theme and text size under **Options** on their phone.

## Alerts

One alert shows at a time, the most severe first: a fault (with its cause, the fix and the raw detail), the room connection reconnecting, the translation reconnecting (attempt n of 3), no input signal for 10 s, no translated audio for 15 s while the input has signal, and input clipping.

## Audio devices

- Device names appear only after the browser has microphone permission. **Test input** in Setup triggers the prompt and shows the input level before the room opens.
- The monitor output can change mid-session (`setSinkId`). Safari does not support `setSinkId`, so the selector is disabled there.
- **Raw audio** disables the browser's echo cancellation, noise suppression and automatic gain control. Turn it on for clean line-level inputs, such as a feed from a mixing desk or a virtual audio cable, where that processing causes pumping or clipping.
- **Copy the translation to tab audio** keeps a second copy of the translation playing on the system default device, so a screen share in Zoom, Meet or OBS still carries the translation while the operator monitors on separate headphones.

## Session details

Updated once a second: connection state of the engine and the room server, engine key validity, first response time (last, median, 95th percentile), time since the last translated text, drops and errors, current and peak listeners, estimated cost and the event log. **Mark** (M) bookmarks the current second in the report, which helps when pairing what the speaker said with what listeners heard.

## What listeners see

The listener page states the broadcast: live, no audio at the moment (8 s of silence while live), paused between speakers, translation reconnecting, broadcast interrupted (the operator tab closed), session ended. A network drop shows "Audio interrupted; reconnecting" and the page rejoins on its own (up to five attempts); it never reports the end of the session for a network problem. Server problems show "Translation unavailable. Event staff can help." without technical detail. The page keeps the screen on while listening.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `OPENAI_API_KEY is not configured on the server` | Key missing from `.env.local` | Add it and restart the dev server |
| `LIVEKIT_API_KEY / LIVEKIT_API_SECRET not configured` | LiveKit values missing | Fill them in, or use single-laptop mode |
| Operator shows "On air" but there is no audio | Monitor set to Mute, tab muted or wrong output device | Check the Monitor button on the channel, tab volume and OS output |
| Phone loads the listener page but buttons do nothing | Dev-origin protection returns 403 for the JavaScript | Add the LAN IP to `ALLOWED_DEV_ORIGINS` and restart |
| Phone cannot reach the listener URL | Different Wi-Fi, or the QR code points at `localhost` | Set `NEXT_PUBLIC_LISTENER_BASE_URL` to the LAN IP |
| Phone shows "Live" but stays silent | iOS blocks autoplay until a tap | The page asks for one tap on Listen; check headphones and volume |
| Translated audio is choppy | Wi-Fi congestion, or WebRTC fell back to TCP on 7881 | Move closer to the access point or use a less congested 5 GHz channel |
| `docker: port is already allocated` | An old LiveKit container still holds 7880 | `docker rm -f livekit-dev` and create it again |

## Cost discipline

The OpenAI session bills for as long as it is open, whether or not anyone is speaking. Pause whenever nobody is presenting. "Show the speaker's original words" adds a second billed transcription stream; leave it off unless the operator needs to see the source transcript. Cross-check the on-screen estimate against the provider's usage dashboard after each session.
