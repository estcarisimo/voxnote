# Live transcription while recording — design note

Status: **proposal, not implemented.** Written 2026-10-30 (UTC) for Esteban's
request (2026-10-30, live site) to see the transcript appear while speaking.
What ships today is _transcribe on Stop_: under a standing per-document
consent, the whole recording is uploaded to the batch endpoint the moment
Stop is tapped. This note covers the next step and what it would take. It
makes no latency or accuracy claim: none has been measured.

## 1. Streaming endpoints that exist today

All read on 2026-10-30 (UTC). None has been called from VoxNote; the shapes below
are what the docs say, nothing more.

| Provider   | Endpoint                                                                                                                   | Audio it accepts                                                                                                                                                                    | Partial vs final                                                                                                                                                                                  | Browser auth                                                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OpenAI     | `wss://api.openai.com/v1/realtime?intent=transcription`, session type `transcription` ([guide][oai-rt])                    | `audio/pcm` at 24 kHz, sent as `input_audio_buffer.append`; `input_audio_buffer.commit` ends a turn                                                                                 | `conversation.item.input_audio_transcription.delta` (partial) and `…completed` (final). `gpt-live-transcribe` streams deltas, has no server VAD; `gpt-transcribe` transcribes only after a commit | Short-lived client secrets ([reference][oai-cs]); the guide sends browsers to WebRTC. Forum reports disagree on TTL and on ephemeral keys working, so this is unverified |
| Deepgram   | `wss://api.deepgram.com/v1/listen` ([reference][dg-ref])                                                                   | Containerized audio (WebM/Opus, Ogg) with no `encoding`/`sample_rate` ([format guide][dg-fmt]); raw audio needs both, e.g. `linear16` plus its rate. MP4 for live use is not stated | `interim_results=true` gives partials; `is_final` marks a final segment, `speech_final` the end of speech ([getting started][dg-live]). Control messages `KeepAlive`, `Finalize`, `CloseStream`   | `Sec-WebSocket-Protocol: token, <key>` ([guide][dg-proto]), so the user's own key works from the browser                                                                 |
| AssemblyAI | `wss://streaming.assemblyai.com/v3/ws` (also `.us.` and `.eu.` residency hosts) ([reference][aai-ref], [guide][aai-guide]) | `pcm_s16le` (default) or `pcm_mulaw` at 8–96 kHz (default 16 kHz); `opus`, `ogg_opus`, ADTS `aac`. Raw AAC and MP4/M4A are not supported                                            | `Turn` messages repeat while speaking; `end_of_turn: true` is final. `{"type":"Terminate"}` flushes the open turn. Billed for the time the socket is open                                         | Temporary token in the `token` query parameter, minted server-side; the docs say never to put the permanent key in client code                                           |
| Groq       | None found. Only batch `POST https://api.groq.com/openai/v1/audio/transcriptions` ([docs][groq])                           | flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm; 10 s minimum billed per request                                                                                                    | n/a                                                                                                                                                                                               | n/a. "Streaming" here would mean re-uploading chunks to the batch endpoint, and each short chunk is billed at the 10 s minimum                                           |

[oai-rt]: https://developers.openai.com/api/docs/guides/realtime-transcription
[oai-cs]: https://developers.openai.com/api/reference/cli/resources/realtime/subresources/client_secrets/index.md
[dg-ref]: https://developers.deepgram.com/reference/speech-to-text/listen-streaming
[dg-fmt]: https://developers.deepgram.com/docs/determining-your-audio-format-for-live-streaming-audio
[dg-live]: https://developers.deepgram.com/docs/live-streaming-audio
[dg-proto]: https://developers.deepgram.com/docs/using-the-sec-websocket-protocol
[aai-ref]: https://www.assemblyai.com/docs/api-reference/streaming-api/streaming-api
[aai-guide]: https://www.assemblyai.com/docs/speech-to-text/universal-streaming
[groq]: https://console.groq.com/docs/speech-to-text

**Auth is the first constraint.** VoxNote has no backend, and keys are the
user's own, in the browser. Deepgram accepts the key as a WebSocket
subprotocol, which fits. OpenAI and AssemblyAI expect a short-lived token;
with no server, the browser would mint it with the user's key and then
connect. That is the same key in the same place it already is, but it is two
requests where the disclosure today names one, and it must be tested before
it is promised.

## 2. Audio capture

- **MediaRecorder stays the source of truth.** It already produces the blob
  that is saved, replayed and sent to the batch path. Live transcription is
  added beside it, never instead of it.
- **Safari's MP4 cannot be chunked for streaming.** `MediaRecorder` on iOS
  Safari gives `audio/mp4` (AAC in MP4), and a fragment cut from it with a
  `timeslice` is not a stream any of the endpoints above take: AssemblyAI
  rules out MP4/M4A, Deepgram does not state it for live use, and OpenAI
  wants PCM. Chromium's WebM/Opus chunks could go to Deepgram as is, but a
  path that only works off iPad misses the point.
- **The likely common path is PCM from an `AudioWorklet`.** Tap the same
  `MediaStream` with an `AudioContext`, convert Float32 frames to 16-bit
  little-endian PCM in the worklet, resample to what the provider wants
  (24 kHz for OpenAI; 16 kHz is AssemblyAI's default; Deepgram takes the rate
  we declare), and post fixed-size frames to the socket. One capture, two
  consumers: the recorder writes the blob, the worklet feeds the socket.
- **iPad specifics to test, not assume:** the `AudioContext` sample rate the
  device actually reports, whether it must be created inside the Voice tap's
  user gesture, and what happens to both consumers when the app goes to the
  background.

## 3. Consent

- **The standing consent from transcribe-on-Stop is the prerequisite**, per
  document, provider, model, host and language, granted only in the dialog,
  shown in the composer, revoked in one tap.
- It is **not enough by itself.** Today's sentence says recordings are sent
  "as soon as you tap Stop". Streaming sends audio _while_ recording, which is
  a different promise. Live mode needs its own grant whose disclosure says so:
  "Audio is streamed to <provider> at <host> while you record, from the moment
  you tap Voice."
- While streaming, the composer shows a live indicator naming the host next
  to the recording timer; one tap stops streaming and leaves the recording
  going, falling back to the Stop path.
- If minting a token is a separate request (OpenAI, AssemblyAI), the
  disclosure names it too.

## 4. Offline and dropped sockets

- **The recording is never lost.** The blob from `MediaRecorder` exists
  whatever the socket does.
- No connection when Voice is tapped, a refused token, or a socket that drops
  mid-recording: streaming stops, the composer says so (fail loudly), the
  partial text shown so far is discarded, and Stop takes the batch path with
  the full blob under the existing standing consent, or the Transcribe… dialog
  without it.
- No silent reconnect that would splice two sessions into one transcript.
  One reconnect attempt is an option for later, only if its seams can be
  shown.

## 5. The raw-transcript invariant

- **Partials are display only.** They may be shown greyed while speaking;
  they are never written to the note, never exported, never become the body.
- **Only finals are the raw transcript.** The raw transcript is the
  concatenation of the final segments of one session, in order, stored once
  with provider, model and a UTC `transcribedAt`, exactly like today's batch
  result (`withTranscript` rules unchanged: an empty body is filled, typed
  text is kept, a raw transcript is never replaced).
- If the session did not end cleanly (no final for the last turn after
  `Finalize` / `commit` / `Terminate`), the streamed text is dropped and the
  batch path runs on the blob. A transcript with a missing tail must not look
  complete.
- Record which path produced the transcript (`live` or `batch`) so exports
  and later evaluation can tell them apart.

## 6. Cost and battery

No numbers here, because none has been measured. Qualitatively: streaming
keeps a socket and an audio graph alive for the whole recording; AssemblyAI
bills for the time the socket is open, not for speech; a live session that
falls back to batch pays twice for the same audio; Groq-style chunked
re-uploads pay a per-request minimum each time. On iPad, a running
`AudioContext` plus radio use while recording will cost battery; how much
must be measured on the device before it is mentioned in the UI or the docs.

## 7. Proposed phasing

1. **Done in this PR:** transcribe on Stop under a standing consent.
2. **Spike, no UI:** an `AudioWorklet` PCM tap beside `MediaRecorder` on a
   real iPad (Safari and Chrome), logging frame rate, reported sample rate and
   background behavior. Nothing leaves the device.
3. **Deepgram live behind a flag** (the one provider whose browser auth fits
   with no extra request): live consent, partials greyed, finals as raw
   transcript, fall back to batch on any drop. Tested against an intercepted
   socket first, then one real session, recorded with date and parameters.
4. **OpenAI Realtime transcription**, once the client-secret flow is verified
   from a browser with a user key.
5. **AssemblyAI** only if a browser-minted temporary token turns out to be
   acceptable under its terms.
6. Measure on iPad (time to final text, battery) with the method written
   down, and only then decide whether live mode is worth keeping.

## 8. Open questions for Esteban

1. Is transcribe-on-Stop already enough for M1, or is seeing words while
   speaking part of the success criterion?
2. Which provider first: Deepgram (fits browser auth) or OpenAI (the key you
   already use)?
3. Is a separate live-mode consent acceptable, or should it be one checkbox
   with both sentences?
4. Should partial text be visible at all while speaking, or only the final
   transcript when a turn ends?
5. Acceptable to pay twice for the same audio when a live session falls back
   to batch, or should a dropped socket just wait for a manual Transcribe…?
6. Is minting a provider's short-lived token in the browser with your own key
   acceptable, given the docs' advice to do it server-side?
