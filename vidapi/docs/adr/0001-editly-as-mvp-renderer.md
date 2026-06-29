# 0001. Editly as MVP Renderer

**Status:** Accepted
**Date:** 2026-05-05

## Context
VidAPI needs a renderer that can compose multi-layer video timelines from JSON
input. Building a native FFmpeg filter graph renderer from scratch would delay
the MVP significantly.

## Options Considered
1. Editly subprocess - Declarative JSON, handles timeline editing, transitions,
   layers, audio. Requires Node.js runtime. Already battle-tested.
2. Native FFmpeg filter graphs - Full control, no Node dependency. Requires
   building complex filter graph generation, overlay timing, audio mixing.
3. Remotion/HyperFrames - Browser-based rendering. High creative ceiling but
   heavy runtime dependency and different composition model.

## Decision
Use Editly as the default MVP renderer, invoked as a Node subprocess. VidAPI
compiles its own composition schema to Editly JSON through a segment compiler.
The public API never exposes Editly internals.

## Consequences
- Faster time to working product: Editly handles timeline sequencing, overlays,
  transitions, and FFmpeg encoding.
- Node.js is required in the worker container alongside Python.
- A segment compiler bridges VidAPI's absolute-time model to Editly's sequential
  clips model -- this is the key implementation complexity.
- Future renderers (FFmpeg-native, HyperFrames) plug in behind the same
  Renderer protocol without changing the public API.
- Editly limitations (transition types, audio mixing) constrain the MVP feature
  set but do not constrain the API schema.
