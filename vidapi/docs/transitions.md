# Transitions

VidAPI exposes a small renderer-independent transition allowlist in the public
composition schema. Renderers receive deterministic mappings from those public
values; clients should not send renderer-native transition names or parameter
objects.

## Supported Values

| Public value | Aliases | Placement | Editly mapping |
|--------------|---------|-----------|----------------|
| `fade_in` | `fadeIn`, `fade-in` | `in` | `fade` |
| `fade_out` | `fadeOut`, `fade-out` | `out` | `fade` |
| `crossfade` | none | `between` | `fade` |
| `directional_left` | `directional-left` | `between` | `directional-left` |
| `directional_right` | `directional-right` | `between` | `directional-right` |
| `directional_up` | `directional-up` | `between` | `directional-up` |
| `directional_down` | `directional-down` | `between` | `directional-down` |
| `wipe_left` | `wipe-left` | `between` | `wipeLeft` |
| `wipe_right` | `wipe-right` | `between` | `wipeRight` |
| `wipe_up` | `wipe-up` | `between` | `wipeUp` |
| `wipe_down` | `wipe-down` | `between` | `wipeDown` |
| `cross_zoom` | `crosszoom`, `cross-zoom` | `between` | `CrossZoom` |
| `simple_zoom` | `simplezoom`, `simple-zoom` | `between` | `SimpleZoom` |
| `circle_open` | `circleopen`, `circle-open` | `between` | `circleopen` |
| `linear_blur` | `linearblur`, `linear-blur` | `between` | `LinearBlur` |

Values outside this table are rejected by schema validation. VidAPI does not
accept Editly arbitrary transition names, `random`, `dummy`, custom shader
params, easing objects, or free-form renderer strings.

## Placement Rules

Each transition value has one valid placement. If `placement` is omitted, the
schema fills in the correct value. If a request supplies a mismatched placement,
the request is rejected during schema validation.

`between` transitions are declared on the outgoing clip. The outgoing clip must
end at the exact start time of a visual successor clip on the same track. Gaps,
overlaps, final clips, audio-only clips, and multiple transitions competing for
the same rendered boundary are rejected before renderer invocation.

## Timing Rules

Transition duration must be positive. The duration must be less than or equal
to the outgoing clip length, and `between` transitions must also fit within the
incoming successor clip.

```json
{
  "asset": {"type": "video", "src": "intro.mp4"},
  "start": 0,
  "length": 2,
  "transition": {"name": "wipe_left", "duration": 0.4}
}
```

Invalid timing example:

```json
{
  "asset": {"type": "video", "src": "intro.mp4"},
  "start": 0,
  "length": 2,
  "transition": {"name": "cross_zoom", "duration": 1.5}
}
```

If the successor clip at `start: 2` is only one second long, the request fails
with `COMPOSITION_LIMIT_EXCEEDED` and the field path
`timeline.tracks[0].clips[0].transition.duration`.

## Conflict Rules

Editly exposes one transition slot per rendered output boundary. VidAPI rejects
requests that would require more than one transition at the same boundary,
including transitions on multiple tracks or combinations like an outgoing
`fade_out` and a `between` transition at the same time.

Validation context is bounded to field paths and scalar values. It does not
include asset URLs, callback URLs, storage paths, renderer specs, stack traces,
or secrets.

## Renderer Support

The current Editly renderer supports every value listed above. Future renderers
must declare their own supported transition set in the renderer capability
registry. Unsupported combinations fail with `UNSUPPORTED_RENDERER_FEATURE` and
bounded context that names the field and enum value only.

There is no fallback from an unsupported or invalid advanced transition to
`fade`. Existing `fade_in`, `fade_out`, and `crossfade` behavior remains
backward compatible when the request satisfies the placement and timing rules.
