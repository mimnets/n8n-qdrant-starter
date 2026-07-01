// Internal Representation (IR) types for the render pipeline.
// The parser converts Shotstack Edit JSON into these structures.

export interface IRTimeline {
  scenes: IRScene[];
  audio: IRAudioMix;
  output: IROutput;
  assets: IRExternalAsset[];
}

export interface IRScene {
  startTime: number;
  duration: number;
  layers: IRLayer[];
  transition?: { type: string; duration: number };
}

export interface IRLayer {
  type: 'visual' | 'audio';
  asset: IRAsset;
  timing: IRTiming;
  effects: IREffects;
  position: IRPosition;
  crop?: IRCrop;
}

export interface IRAsset {
  type: string; // 'video' | 'image' | 'text' | 'richtext' | 'audio' | 'shape' | 'svg' | 'html' | 'luma' | 'caption' | 'title' | 'text-to-image' | 'image-to-video'
  src?: string;
  text?: string;
  html?: string;
  css?: string;
  font?: {
    family?: string;
    size?: number;
    color?: string;
    weight?: number;
  };
  stroke?: { color?: string; width?: number };
  background?: string;
  alignment?: { horizontal?: string; vertical?: string };
  volume?: number;
  volumeEffect?: string;
  speed?: number;
  trim?: number;
  [key: string]: any;
}

export interface IRTiming {
  start: number;
  duration: number;
  transitionIn?: string;
  transitionOut?: string;
}

export interface IREffects {
  motion?: string;
  filter?: string;
  opacity?: number | IRTween[];
  transform?: IRTransform;
  tween?: IRTween[];
}

export interface IRTween {
  from: number;
  to: number;
  start: number;
  length: number;
  interpolation?: string;
  easing?: string;
}

export interface IRTransform {
  rotate?: { angle: number };
  skew?: { x: number; y: number };
  flip?: { horizontal?: boolean; vertical?: boolean };
}

export interface IRPosition {
  fit: string; // crop | cover | contain | none
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface IRCrop {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface IRAudioMix {
  soundtrack?: { src: string; effect?: string; volume: number };
  clips: IRAudioClip[];
}

export interface IRAudioClip {
  src: string;
  start: number;
  duration: number;
  volume: number;
  volumeEffect?: string;
  speed?: number;
}

export interface IROutput {
  width: number;
  height: number;
  fps: number;
  format: string;
  quality: string;
  scaleTo?: string;
  range?: { start: number; length: number };
  poster?: { capture: number };
  thumbnail?: { capture: number; width: number };
  destinations?: any[];
  mute?: boolean;
  repeat?: boolean;
}

export interface IRExternalAsset {
  url: string;
  localPath?: string;
  type: 'video' | 'image' | 'audio' | 'font';
}

// Shotstack Edit JSON input types (subset for parsing)

export interface ShotstackEdit {
  timeline: ShotstackTimeline;
  output: ShotstackOutput;
  merge?: ShotstackMergeField[];
  callback?: string;
  disk?: string;
}

export interface ShotstackTimeline {
  soundtrack?: { src: string; effect?: string; volume?: number };
  background?: string;
  fonts?: { src: string }[];
  tracks: ShotstackTrack[];
}

export interface ShotstackTrack {
  clips: ShotstackClip[];
}

export interface ShotstackClip {
  asset: ShotstackAsset;
  start: number | 'auto';
  length: number | 'auto' | 'end';
  fit?: string;
  scale?: number;
  position?: string;
  offset?: { x?: number; y?: number };
  transition?: { in?: string; out?: string };
  effect?: string;
  filter?: string;
  opacity?: number | ShotstackTween[];
  transform?: {
    rotate?: { angle?: number };
    skew?: { x?: number; y?: number };
    flip?: { horizontal?: boolean; vertical?: boolean };
  };
  crop?: { top?: number; bottom?: number; left?: number; right?: number };
}

export interface ShotstackAsset {
  type: string;
  src?: string;
  text?: string;
  html?: string;
  css?: string;
  font?: { family?: string; size?: number; color?: string; weight?: number };
  stroke?: { color?: string; width?: number };
  background?: string;
  alignment?: { horizontal?: string; vertical?: string };
  volume?: number;
  volumeEffect?: string;
  speed?: number;
  trim?: number;
  [key: string]: any;
}

export interface ShotstackTween {
  from: number;
  to: number;
  start: number;
  length: number;
  interpolation?: string;
  easing?: string;
}

export interface ShotstackOutput {
  format: string;
  resolution?: string;
  aspectRatio?: string;
  size?: { width: number; height: number };
  fps?: number;
  quality?: string;
  scaleTo?: string;
  range?: { start: number; length: number };
  poster?: { capture: number };
  thumbnail?: { capture: number; width: number };
  destinations?: any[];
  mute?: boolean;
  repeat?: boolean;
}

export interface ShotstackMergeField {
  find: string;
  replace: string | number;
}
