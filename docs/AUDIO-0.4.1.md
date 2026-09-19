# Audio source-selection repair: v0.4.1

September 18, 2026.

A household Android Chrome playback produced picture with no sound. This symptom is consistent with a browser decoding the video track while not decoding the selected release's audio track. The change does not claim the exact file's codec was directly inspected.

## Behavior change

Source metadata from Zilean now carries structured video codec, audio codec and resolution fields through normalization and registration. Source ranking heavily prefers H.264 with AAC audio. Cache availability remains useful, but a cached Dolby/DTS release no longer outranks a browser-friendlier H.264/AAC release solely because it is cached.

The source picker identifies H.264/AAC as the best browser bet. Dolby Digital, E-AC-3, AC-3, DDP, Dolby Atmos, DTS/DTS-HD and TrueHD are marked as possible silent-audio risks in Chrome. HEVC/H.265 and AV1 retain separate video-compatibility cautions.

When a selected prepared source is known from source metadata to carry a risky Dolby/DTS audio format, the application no longer immediately closes the source dialog and starts playback. It explains that the audio may be silent and requires an explicit Play anyway action. If a browser-friendly source exists, the primary action selects it even when another incompatible source is already cached.

This is source-selection and warning logic, not transcoding. Index metadata can be incomplete or inaccurate, and a release with unknown audio can still fail. The existing TorBox conversion limitation is unchanged.

## Verification

Eight new audio-selection tests cover H.264/AAC priority, Dolby/DTS detection, Zilean structured metadata propagation, source normalization, preferred-source choice, compatibility outranking cache convenience, and the ready-source warning state.

The final Render build registered 156 tests: 151 passed, zero failed and five optional live checks were skipped. Existing authentication, catalog, source lookup, GitHub Pages CORS/bearer-session, preparation, relay and progress tests remained green.

GitHub Pages workflow run 35410319599 successfully published the frontend commit containing the audio-selection change.

No subscription, provider key, password, TorBox key, hosting tier or database was changed.
