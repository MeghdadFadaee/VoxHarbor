# Experimental Opus audio

The browser uses 48 kHz AudioWorklets and the pinned `libopus-wasm` worker. Opus Voice (4) and Opus Music (5) with 20 ms frames are supported; outgoing capture is mono. Other codecs/frame durations are rejected. No media leaves until the owner explicitly enables listening, enables the microphone, and permits transmission with push-to-talk or voice activation.

Incoming speakers have independent decoders, 60 ms initial jitter buffering, at most 12 queued packets, FEC/PLC and bounded mixing. Three misses end a talk spurt. There are at most 32 active speakers; idle decoder state expires. Capture credits, worker queues, native stdin, WebSocket backlogs and playback queues are bounded; stale frames are dropped. These are implementation limits, not an end-to-end audio-quality guarantee. TCP/WebSocket head-of-line blocking remains a limitation.

Input/output start muted on new sessions. Disconnect, logout, hidden pages, input/device loss and suspended audio stop transmission. During automatic reconnection, listening resumes if it was enabled. The microphone resumes only when it was enabled and the user checked “Resume my enabled microphone after automatic reconnect.” These choices live only in the current signed-in page; reload/sign-out clears them. Hiding the page cancels pending recovery and mutes the microphone. Manual disconnect, successful channel changes, device errors and sign-out clear recovery. A denied channel join preserves current audio. Push-to-talk never restores a held press. Browser restrictions can still require a manual audio enable action. Pending permission/initialization work cannot resurrect a stopped instance. Concurrent startup shares codec initialization; participant volume chosen before startup is retained. Per-user gain is bounded from 0 to 2.

PTT works while the page has focus; it is not a global shortcut. Echo cancellation, noise suppression and gain control are requested from the browser. Output selection depends on `AudioContext.setSinkId`. A browser that cannot provide the required 48 kHz worklet is rejected; resampling is not implemented. Safari, Firefox, Bluetooth, mobile suspension, actual microphone hardware and audible browser playback need separate testing.

## Verification

`npm test` covers actual Opus encoding/decoding, independent speaker decoding/mixing, loss and sequence wrapping, malformed frames, bounded queues, PTT release and lifecycle races. Worklet processor tests do not simulate browser scheduling.

For a silent browser test, run `npm run audio:qa`, open the local address it prints and choose **Run silent pipeline test**. This uses generated audio, real worklets and the actual worker/codec with deliberate losses. It requests no microphone, emits silence to hardware and contacts no TeamSpeak server. Reports are synthetic diagnostics, not a real conversation pass.

Before cleanup, a private deployment passed generated two-way audio through a real authorized TS3 server and a second native client. Frame counts were bounded-window observations, not loss/latency benchmarks. Real microphone capture, browser speaker audibility, multiple live speakers and official-client conversational interoperability remain unverified. To test them, use an authorized test channel and consenting participants; never record voice contents or broadcast test tones into an unsuspecting channel.

## Connection diagnostics

Connection diagnostics → Download JSON (or account settings → Diagnostics) exports the last 1,000 bounded events for this signed-in page. It records native session status (including the current 240-second session cap), socket close codes, connection duration, time since the last message, heartbeat round-trip times, retry delays/attempts, protocol error codes and browser online/visibility changes. The log excludes server addresses, account identifiers, close-reason text, credentials, messages and media. It remains in memory, clears on sign-out/reload, and is never automatically uploaded. Download it after a problem and before reloading. A close code alone does not prove the underlying network or hosting cause.
