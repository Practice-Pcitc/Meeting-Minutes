# Repository UI conventions

- Reuse the project's custom form controls instead of native browser controls whenever an equivalent exists.
- Use `AppSelect.vue` for all user-facing dropdown/select fields. Do not introduce native `<select>` elements in feature UI.
- Use `DateTimePicker.vue` for date, time, and datetime fields. Do not introduce native date/time inputs.
- Before adding a new form control, search `meeting-minutes-vue/src/components` for an existing reusable component and keep interaction and styling consistent across views.

# Recording and transcription conventions

- Keep manual meeting entries and automatic recording independent. Recording must continue while the user visits another meeting tab, but switching to another meeting must confirm and stop the active recording first.
- Preserve the original MediaRecorder upload as the source of truth for playback and download. Live transcription is an additional PCM stream and must not replace or mutate the saved recording.
- Use AudioWorklet plus the local WebSocket endpoint for live text. Do not implement live transcription by repeatedly sending the entire growing recording file; its latency and compute cost grow with meeting length.
- Treat live transcription as partial and committed text. Partial text may be replaced for the current utterance; text committed after a pause must only be appended and must not be overwritten by later utterances.
- When live text exists at recording completion, persist it as the recording transcript and do not automatically overwrite it with full-file transcription. Full-file transcription remains an explicit retry/fallback action.
- Full-file transcription must use VAD-based bounded segments before ASR. Never pass an unbounded meeting-length waveform directly to the Paraformer ONNX model.
- Keep local speech runtime artifacts out of Git: `.funasr-onnx/`, `.funasr-heavy-backup/`, `.runtime/`, model caches, Python bytecode, recordings, and user data.
- The local FunASR service contract is `POST /v1/audio/transcriptions` for completed files, `WS /v1/audio/realtime` for PCM streaming, and `GET /health` for readiness.
- Manage the Python speech service exclusively as the uv project in `tools/pyproject.toml`. Keep `tools/uv.lock` committed, use `uv run --locked` in launch scripts, and do not reintroduce hand-maintained virtualenv or requirements installation flows.
