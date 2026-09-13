# presage-worker (Lane D)

Runs on the demo laptop. Thirty seconds of webcam via the Presage SmartSpectra headless Node SDK
(`useCamera()`), then the median pulse and breathing rate from the confident second half of the
capture are POSTed to the Scallion API as the contract's `/vitals` payload. Frames never leave the
SDK process; only the numbers below go over the wire.

```
npm install                 # pulls the native runtime for every platform (a few hundred MB, once)
npm test                    # summarize + token + watch unit tests, no camera, no key
node index.mjs --watch      # DEMO: stay running; capture + POST each time a phone presses Start
node index.mjs --dry-run    # capture and print, do not POST
node index.mjs              # one capture, POST to $SCALLION_API_URL/vitals
node index.mjs --seconds 30 --device 0 --verbose
node index.mjs --watch --replay test/fixtures/capture_real.json   # no camera: post the recorded capture per Start
```

`--watch` polls `GET /vitals/arm` for every token every 2 s (contract v12). When the camera screen's
Start arms an account, it spawns one `node index.mjs` child (the other flags pass through) that
captures, POSTs, and exits; then it goes back to polling. Leave it running for the whole demo.
When a capture fails the watcher tells the phone why (`PATCH /vitals/arm` note): a busy webcam
(Media Foundation `0xC00D3704`: Teams, Zoom, or a browser tab holding the camera) ends the arm at
once; "no face" / "face lost" get one retry while the phone still waits. Nothing else may hold the
laptop webcam while the watcher runs; the app's camera page no longer opens a preview once armed.

Environment (read from the repo-root `.env`): `PRESAGE_API_KEY` (physiology.presagetech.com),
`SCALLION_API_URL` (default `http://localhost:8000`), `SCALLION_API_TOKEN` (one or more Supabase JWTs,
comma-separated; not needed when the API runs with `DEV_AUTH_BYPASS=1`). The reading is POSTed once per
token, and the terminal prints which user each token is for and how long it stays valid. The camera
screen only reads its own user's `/vitals/latest`, so the token list must cover the account the phone
is signed in to (the shared demo account, plus the presenter's own).

Payload (`test/fixtures/payload.json` is the reference the API test posts):

```json
{"source":"presage","pulse_bpm":62,"breathing_bpm":15,"stress_index":98.4,
 "captured_at":"2026-09-12T14:00:00.000Z","hrv_rmssd_ms":41.2,"confidence":0.9,"samples":15}
```

`stress_index` is the SDK's Baevsky index from its HRV block and `hrv_rmssd_ms` is exploratory (last
in the cut order); both are null when the SDK did not produce them within the capture.
Exit codes: 0 posted, 1 no confident reading (hold still, face the light), 2 no `PRESAGE_API_KEY`.
