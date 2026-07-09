import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

import {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';
import { remotionApiRequest, pollRender } from './GenericFunctions';

// -------------------------------------------------------------------
// Helper: get field with fallback chain
// -------------------------------------------------------------------
function getVal(item: IDataObject, fallbacks: string[], defaultVal: any): any {
	for (const k of fallbacks) {
		const val = item[k];
		if (val !== undefined && val !== null && val !== '') return val;
	}
	return defaultVal;
}

// -------------------------------------------------------------------
// Node
// -------------------------------------------------------------------
export class RemotionRender implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Remotion Render - mimnets',
		name: 'remotionRender',
		icon: 'file:remotion.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] === "render" ? "Render Video" : "Check Status"}}',
		description: 'Render videos using self-hosted Remotion (by mimnets)',
		defaults: {
			name: 'Remotion Render - mimnets',
		},
		inputs: ['main' as const],
		outputs: ['main' as const],
		credentials: [
			{
				name: 'remotionRenderApi',
				required: true,
			},
		],
		properties: [
			// ================================================================
			// OPERATION SELECTOR
			// ================================================================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Render Video',
						value: 'render',
						description: 'Send timeline to Remotion and wait for the rendered video',
						action: 'Render a video using Remotion',
					},
					{
						name: 'Check Render Status',
						value: 'checkStatus',
						description: 'Check the status of a previously submitted render',
						action: 'Check the status of a render',
					},
				],
				default: 'render',
			},

			// ---- Check Status fields ----
			{
				displayName: 'Render ID',
				name: 'renderId',
				type: 'string',
				required: true,
				displayOptions: {
					show: { operation: ['checkStatus'] },
				},
				default: '',
				description: 'ID of the render to check (returned from a Render Video operation)',
			},

			// ================================================================
			// INPUT SOURCE — Manual or Batch Render
			// ================================================================
			{
				displayName: 'Input Method',
				name: 'inputSource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Manual — configure below',
						value: 'manual',
						description: 'Add images, text, and audio clips manually in the node UI',
					},
					{
						name: '⚡ Batch Render — render each scene & concat via ffmpeg',
						value: 'batchRender',
						description:
							'Each upstream item = one scene. Renders individually via Remotion, then concatenates with ffmpeg. Returns the final video as binary output (no internal upload). Scene items can override defaults per-item.',
					},
				],
				default: 'manual',
				displayOptions: {
					show: { operation: ['render'] },
				},
				description: 'How to provide the timeline data for rendering',
			},

			// ---- Batch Render options ----
			{
				displayName:
					'<strong>Each upstream item should look like:</strong>\n' +
					'<code>{"imageUrl": "...", "audioUrl": "...", "caption": "...", "duration": 5, "effect": "slideLeft", "fontColor": "#FFD700"}</code>\n\n' +
					'<strong>How it works:</strong>\n' +
					'• Each scene is rendered individually via Remotion (one-at-a-time)\n' +
					'• Scenes are concatenated with ffmpeg (instant, no re-encode)\n' +
					'• The final video is returned as binary data — connect downstream nodes to handle upload\n\n' +
					'<strong>Per-item overrides (optional):</strong>\n' +
					'Each item can override defaults via fields: effect, fit, fadeIn, fadeOut, ' +
					'fontSize, fontColor, fontFamily, fontWeight, background, ' +
					'captionStyle, combineMs, textAnimation, vertical, horizontal\n\n' +
					'<strong>Requirements:</strong>\n' +
					'• n8n container must have ffmpeg installed\n' +
					'• Total time = sum of each scene render time',
				name: 'batchRenderNote',
				type: 'notice',
				displayOptions: {
					show: { operation: ['render'], inputSource: ['batchRender'] },
				},
				default: '',
			},
			{
				displayName: 'Resolution',
				name: 'combinerResolution',
				type: 'options',
				displayOptions: {
					show: { operation: ['render'], inputSource: ['batchRender'] },
				},
				options: [
					{ name: 'Preview (512×288)', value: 'preview' },
					{ name: 'Mobile (640×360)', value: 'mobile' },
					{ name: 'SD (1024×576)', value: 'sd' },
					{ name: 'HD (1280×720)', value: 'hd' },
					{ name: 'Full HD (1920×1080)', value: '1080' },
					{ name: 'Vertical / Reels (1080×1920)', value: 'vertical' },
					{ name: '4K (3840×2160)', value: '4k' },
				],
				default: 'vertical',
				description: 'Video resolution for the combined output',
			},
			{
				displayName: 'FPS',
				name: 'combinerFps',
				type: 'number',
				displayOptions: {
					show: { operation: ['render'], inputSource: ['batchRender'] },
				},
				default: 30,
				typeOptions: { minValue: 1, maxValue: 60 },
				description: 'Frames per second',
			},

			// ---- Batch Render Defaults — image & text overrides ----
			{
				displayName: 'Batch Render Defaults',
				name: 'batchRenderDefaults',
				placeholder: 'Defaults',
				type: 'fixedCollection',
				typeOptions: {
					collapsible: true,
				},
				displayOptions: {
					show: { operation: ['render'], inputSource: ['batchRender'] },
				},
				default: {},
				options: [
					{
						name: 'defaults',
						displayName: 'Defaults',
						values: [
							// ===== Image defaults =====
							{
								displayName: 'Image Effect',
								name: 'imageEffect',
								type: 'options',
								options: [
									{ name: 'None', value: '' },
									{ name: 'Zoom In', value: 'zoomIn' },
									{ name: 'Zoom Out', value: 'zoomOut' },
									{ name: 'Zoom In Fast', value: 'zoomInFast' },
									{ name: 'Zoom Out Fast', value: 'zoomOutFast' },
									{ name: 'Slide Left', value: 'slideLeft' },
									{ name: 'Slide Right', value: 'slideRight' },
									{ name: 'Slide Up', value: 'slideUp' },
									{ name: 'Slide Down', value: 'slideDown' },
								],
								default: 'zoomIn',
								description:
									'Ken Burns effect. Items can override with their own "effect" field.',
							},
							{
								displayName: 'Image Fit',
								name: 'imageFit',
								type: 'options',
								options: [
									{ name: 'Cover (fill & crop)', value: 'cover' },
									{ name: 'Contain (fit inside)', value: 'contain' },
									{ name: 'Fill (stretch)', value: 'fill' },
								],
								default: 'cover',
								description:
									'How the image fits the frame. Items can override with "fit" field.',
							},
							{
								displayName: 'Image Fade In',
								name: 'imageFadeIn',
								type: 'boolean',
								default: false,
								description:
									'Fade in at scene start. Items can override with "fadeIn" field.',
							},
							{
								displayName: 'Image Fade Out',
								name: 'imageFadeOut',
								type: 'boolean',
								default: false,
								description:
									'Fade out at scene end. Items can override with "fadeOut" field.',
							},

							// ===== Randomize toggle =====
							{
								displayName: '🎲 Randomize Image Effect per scene',
								name: 'shuffleEnabled',
								type: 'boolean',
								default: false,
								description:
									'When enabled, each scene without an explicit "effect" field gets a random Ken Burns effect. Image Fit and Fades are not randomized. Manual per-item overrides still take precedence.',
							},

							// ===== Text defaults =====
							{
								displayName: 'Font Family',
								name: 'fontFamily',
								type: 'string',
								default: 'Inter',
								description:
									'CSS font family. Items can override with "fontFamily" field.',
								placeholder: 'Inter',
							},
							{
								displayName: 'Font Size',
								name: 'fontSize',
								type: 'number',
								default: 36,
								typeOptions: { minValue: 12, maxValue: 200 },
								description:
									'Font size in pixels. Items can override with "fontSize" field.',
							},
							{
								displayName: 'Font Color',
								name: 'fontColor',
								type: 'color',
								default: '#FFFFFF',
								description:
									'Text color. Items can override with "fontColor" field.',
							},
							{
								displayName: 'Font Weight',
								name: 'fontWeight',
								type: 'number',
								default: 400,
								typeOptions: { minValue: 100, maxValue: 900 },
								description:
									'Font weight (400=normal, 700=bold). Items can override with "fontWeight" field.',
							},
							{
								displayName: 'Background Color',
								name: 'background',
								type: 'string',
								default: 'rgba(0,0,0,0.3)',
								placeholder: 'rgba(0,0,0,0.3)',
								description:
									'Background behind text (CSS color). Items can override with "background" field.',
							},
							{
								displayName: 'Caption Style',
								name: 'captionStyle',
								type: 'options',
								options: [
									{ name: 'Static', value: 'static', description: 'Normal text overlay' },
									{ name: 'TikTok Style', value: 'tiktok', description: 'Word-by-word highlighting' },
								],
								default: 'tiktok',
								description:
									'How captions are rendered. Items can override with "captionStyle" field.',
							},
							{
								displayName: 'Word Timing (ms)',
								name: 'combineMs',
								type: 'number',
								default: 400,
								typeOptions: { minValue: 100, maxValue: 3000 },
								description:
									'Milliseconds per word (TikTok style only). Items can override with "combineMs" field.',
							},
							{
								displayName: 'Text Animation',
								name: 'textAnimation',
								type: 'options',
								options: [
									{ name: 'None', value: 'none' },
									{ name: 'Fade In', value: 'fadeIn' },
									{ name: 'Slide Up', value: 'slideUp' },
									{ name: 'Scale In', value: 'scale' },
									{ name: 'Typewriter', value: 'typewriter' },
								],
								default: 'none',
								description:
									'Text entrance animation. Items can override with "textAnimation" field.',
							},
							{
								displayName: 'Vertical Position',
								name: 'vertical',
								type: 'options',
								options: [
									{ name: 'Top', value: 'top' },
									{ name: 'Center', value: 'center' },
									{ name: 'Bottom', value: 'bottom' },
								],
								default: 'bottom',
								description:
									'Vertical alignment. Items can override with "vertical" field.',
							},
							{
								displayName: 'Horizontal Position',
								name: 'horizontal',
								type: 'options',
								options: [
									{ name: 'Left', value: 'left' },
									{ name: 'Center', value: 'center' },
									{ name: 'Right', value: 'right' },
								],
								default: 'center',
								description:
									'Horizontal alignment. Items can override with "horizontal" field.',
							},
						],
					},
				],
				description: 'Default image and text settings for Batch Render. Each scene item can override these via matching field names.',
			},

			// ================================================================
			// IMAGES — fixedCollection, multipleValues (Manual mode only)
			// ================================================================
			{
				displayName: 'Images',
				name: 'images',
				placeholder: 'Add Image',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				displayOptions: {
					show: { operation: ['render'], inputSource: ['manual'] },
				},
				default: {},
				options: [
					{
						name: 'image',
						displayName: 'Image',
						values: [
							{
								displayName: 'Image URL',
								name: 'src',
								type: 'string',
								default: '',
								placeholder: 'https://example.com/image.jpg',
								required: true,
								description: 'URL of the image to display',
							},
							{
								displayName: 'Start (seconds)',
								name: 'start',
								type: 'number',
								default: 0,
								description: 'When this image appears in the video (in seconds)',
							},
							{
								displayName: 'Length (seconds)',
								name: 'length',
								type: 'number',
								default: 5,
								description: 'How long this image stays on screen (in seconds)',
							},
							{
								displayName: 'Ken Burns Effect',
								name: 'effect',
								type: 'options',
								options: [
									{ name: 'None', value: '' },
									{ name: 'Zoom In', value: 'zoomIn' },
									{ name: 'Zoom Out', value: 'zoomOut' },
									{ name: 'Zoom In Fast', value: 'zoomInFast' },
									{ name: 'Zoom Out Fast', value: 'zoomOutFast' },
									{ name: 'Slide Left', value: 'slideLeft' },
									{ name: 'Slide Right', value: 'slideRight' },
									{ name: 'Slide Up', value: 'slideUp' },
									{ name: 'Slide Down', value: 'slideDown' },
								],
								default: '',
								description: 'Ken Burns animation effect for this image',
							},
							{
								displayName: 'Fade In',
								name: 'fadeIn',
								type: 'boolean',
								default: false,
								description: 'Whether to fade in at the start of this clip',
							},
							{
								displayName: 'Fade Out',
								name: 'fadeOut',
								type: 'boolean',
								default: false,
								description: 'Whether to fade out at the end of this clip',
							},
						],
					},
				],
				description: 'Images to include in the video timeline',
			},

			// ================================================================
			// TEXTS — fixedCollection, multipleValues (Manual mode only)
			// ================================================================
			{
				displayName: 'Text Overlays',
				name: 'texts',
				placeholder: 'Add Text',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				displayOptions: {
					show: { operation: ['render'], inputSource: ['manual'] },
				},
				default: {},
				options: [
					{
						name: 'text',
						displayName: 'Text',
						values: [
							{
								displayName: 'Text',
								name: 'text',
								type: 'string',
								typeOptions: {
									rows: 2,
								},
								default: '',
								placeholder: 'Enter caption text...',
								required: true,
								description: 'The caption text to display',
							},
							{
								displayName: 'Start (seconds)',
								name: 'start',
								type: 'number',
								default: 0,
								description: 'When this text appears (in seconds)',
							},
							{
								displayName: 'Length (seconds)',
								name: 'length',
								type: 'number',
								default: 5,
								description: 'How long this text stays on screen (in seconds)',
							},
							{
								displayName: 'Vertical Position',
								name: 'vertical',
								type: 'options',
								options: [
									{ name: 'Top', value: 'top' },
									{ name: 'Center', value: 'center' },
									{ name: 'Bottom', value: 'bottom' },
								],
								default: 'bottom',
								description: 'Vertical alignment on screen — "bottom" is typical for captions',
							},
							{
								displayName: 'Horizontal Position',
								name: 'horizontal',
								type: 'options',
								options: [
									{ name: 'Left', value: 'left' },
									{ name: 'Center', value: 'center' },
									{ name: 'Right', value: 'right' },
								],
								default: 'center',
								description: 'Horizontal alignment on screen',
							},
							{
								displayName: 'Font Family',
								name: 'fontFamily',
								type: 'string',
								default: 'Inter',
								description: 'CSS font family name (must be available in the Remotion container)',
							},
							{
								displayName: 'Font Size',
								name: 'fontSize',
								type: 'number',
								default: 36,
								description: 'Font size in pixels (scales with resolution)',
							},
							{
								displayName: 'Font Weight',
								name: 'fontWeight',
								type: 'number',
								default: 400,
								description: 'Font weight (100–900, 400=normal, 700=bold)',
							},
							{
								displayName: 'Font Color',
								name: 'fontColor',
								type: 'color',
								default: '#FFFFFF',
								description: 'Text color',
							},
							{
								displayName: 'Background Color',
								name: 'background',
								type: 'string',
								default: 'rgba(0,0,0,0.3)',
								placeholder: 'rgba(0,0,0,0.3)',
								description: 'Background behind the text (CSS color). Empty = transparent',
							},
							{
								displayName: 'Animation',
								name: 'textAnimation',
								type: 'options',
								options: [
									{ name: 'None', value: 'none' },
									{ name: 'Fade In', value: 'fadeIn' },
									{ name: 'Slide Up', value: 'slideUp' },
									{ name: 'Scale In', value: 'scale' },
									{ name: 'Typewriter', value: 'typewriter' },
								],
								default: 'none',
								description: 'Text entrance animation',
							},
							{
								displayName: 'Caption Style',
								name: 'captionStyle',
								type: 'options',
								options: [
									{ name: 'Static', value: 'static', description: 'Normal text overlay' },
									{ name: 'TikTok Style', value: 'tiktok', description: 'Word-by-word highlighting' },
								],
								default: 'static',
								description: 'How captions are rendered. TikTok style highlights each word as it is spoken',
							},
							{
								displayName: 'Word Timing (ms)',
								name: 'combineMs',
								type: 'number',
								default: 400,
								displayOptions: {
									show: { captionStyle: ['tiktok'] },
								},
								typeOptions: { minValue: 100, maxValue: 3000 },
								description: 'Milliseconds per word. Lower = faster word-by-word. Higher = more words per page (400 = classic TikTok style, 1200 = sentence-by-sentence)',
							},
						],
					},
				],
				description: 'Text overlays to display over the video',
			},

			// ================================================================
			// AUDIO CLIPS — fixedCollection, multipleValues (Manual mode only)
			// ================================================================
			{
				displayName: 'Audio Clips',
				name: 'audios',
				placeholder: 'Add Audio',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				displayOptions: {
					show: { operation: ['render'], inputSource: ['manual'] },
				},
				default: {},
				options: [
					{
						name: 'audio',
						displayName: 'Audio',
						values: [
							{
								displayName: 'Audio URL',
								name: 'src',
								type: 'string',
								default: '',
								placeholder: 'https://example.com/audio.mp3',
								required: true,
								description: 'URL of the audio file',
							},
							{
								displayName: 'Start (seconds)',
								name: 'start',
								type: 'number',
								default: 0,
								description: 'When this audio starts playing (in seconds)',
							},
							{
								displayName: 'Length (seconds)',
								name: 'length',
								type: 'number',
								default: 5,
								description: 'How long this audio plays (in seconds)',
							},
						],
					},
				],
				description: 'Scene-specific audio clips',
			},

			// ================================================================
			// SOUNDTRACK (Manual mode only)
			// ================================================================
			{
				displayName: 'Soundtrack',
				name: 'soundtrack',
				type: 'fixedCollection',
				displayOptions: {
					show: { operation: ['render'], inputSource: ['manual'] },
				},
				default: {},
				options: [
					{
						name: 'track',
						displayName: 'Soundtrack',
						values: [
							{
								displayName: 'Audio URL',
								name: 'src',
								type: 'string',
								default: '',
								placeholder: 'https://example.com/music.mp3',
								description: 'Background music or audio that plays throughout the video',
							},
							{
								displayName: 'Volume',
								name: 'volume',
								type: 'number',
								default: 0.15,
								typeOptions: {
									minValue: 0,
									maxValue: 1,
									numberPrecision: 2,
								},
								description: 'Volume level (0 = silent, 0.15 = background, 1 = full)',
							},
						],
					},
				],
				description: 'Background audio that plays throughout the video (optional)',
			},

			// ================================================================
			// OUTPUT SETTINGS (Manual mode only)
			// ================================================================
			{
				displayName: 'Output Settings',
				name: 'outputSettings',
				type: 'fixedCollection',
				displayOptions: {
					show: { operation: ['render'], inputSource: ['manual'] },
				},
				default: {},
				options: [
					{
						name: 'settings',
						displayName: 'Settings',
						values: [
							{
								displayName: 'Resolution',
								name: 'resolution',
								type: 'options',
								options: [
									{ name: 'Preview (512×288)', value: 'preview' },
									{ name: 'Mobile (640×360)', value: 'mobile' },
									{ name: 'SD (1024×576)', value: 'sd' },
									{ name: 'HD (1280×720)', value: 'hd' },
									{ name: 'Full HD (1920×1080)', value: '1080' },
									{ name: 'Vertical / Reels (1080×1920)', value: 'vertical' },
									{ name: '4K (3840×2160)', value: '4k' },
								],
								default: '1080',
								description: 'Video resolution preset',
							},
							{
								displayName: 'FPS',
								name: 'fps',
								type: 'number',
								default: 25,
								typeOptions: {
									minValue: 1,
									maxValue: 60,
								},
								description: 'Frames per second',
							},
						],
					},
				],
				description: 'Video output settings',
			},
		],
	};

	// ====================================================================
	// EXECUTE
	// ====================================================================
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const credentials = await this.getCredentials('remotionRenderApi');
		const baseUrl = (credentials.serverUrl as string).replace(/\/+$/, '');
		const operation = this.getNodeParameter('operation', 0) as string;

		// ---- CHECK STATUS ----
		if (operation === 'checkStatus') {
			for (let i = 0; i < items.length; i++) {
				const renderId = this.getNodeParameter('renderId', i) as string;
				const response = await remotionApiRequest.call(
					this,
					'GET',
					`/edit/v1/render/${renderId}`,
				);
				const data = response as IDataObject;
				const resp = data.response as IDataObject | undefined;
				returnData.push({
					json: {
						renderId,
						status: resp?.status || 'unknown',
						videoUrl: resp?.url ? `${baseUrl}${resp.url}` : null,
					},
				});
			}
			return [returnData];
		}

		// ---- RENDER VIDEO ----
		const inputSource = this.getNodeParameter('inputSource', 0, 'manual') as string;

		if (inputSource === 'batchRender') {
			// ----------------------------------------------------------------
			// BATCH RENDER — render each scene individually, concat with ffmpeg,
			// return final video as binary data (NO internal upload)
			// Supports per-item overrides from scene JSON fields.
			// ----------------------------------------------------------------
			try {
				const resolution = this.getNodeParameter('combinerResolution', 0, 'vertical') as string;
				const fps = this.getNodeParameter('combinerFps', 0, 30) as number;

				// Read batch render UI defaults
				const defaultsParam = this.getNodeParameter('batchRenderDefaults', 0, {}) as IDataObject;
				const rawDefaults = (defaultsParam.defaults as any);
				// n8n 2.x stores fixedCollection as object, legacy as array
				let d: IDataObject = {};
				if (Array.isArray(rawDefaults)) {
					d = rawDefaults.length > 0 ? (rawDefaults[0] as IDataObject) : {};
				} else if (typeof rawDefaults === 'object' && rawDefaults !== null) {
					d = rawDefaults as IDataObject;
				}

				const tempDir = '/tmp/remotion-batch-' + Date.now();
				fs.mkdirSync(tempDir, { recursive: true });

				const sceneFiles: string[] = [];

				try {
					for (let i = 0; i < items.length; i++) {
						const scene = items[i]?.json as IDataObject;
						const imageUrl = scene.imageUrl as string || '';
						const audioUrl = scene.audioUrl as string || '';
						const caption = scene.caption as string || '';
						const duration = Number(scene.duration) || 5;
						const sceneNum = scene.scene_number || (i + 1);

						// Per-item image overrides (scene field > shuffle > UI default > hardcoded)
						const sceneEffect = scene.effect || scene.imageEffect;
						const sceneFit = scene.fit || scene.imageFit;
						const sceneFadeIn = scene.fadeIn !== undefined ? scene.fadeIn : scene.imageFadeIn;
						const sceneFadeOut = scene.fadeOut !== undefined ? scene.fadeOut : scene.imageFadeOut;

						// Shuffle picks random effect for non-explicit fields
						let shuffleEffect: string | undefined;
						if (d.shuffleEnabled) {
							const FX = ['zoomIn','zoomOut','slideLeft','slideRight','slideUp','slideDown','zoomInFast','zoomOutFast'];
							shuffleEffect = FX[Math.floor(Math.random() * FX.length)];
						}

						// Resolve: scene > shuffle > UI default > hardcoded
						const effect = sceneEffect || shuffleEffect || (d.imageEffect as string) || 'zoomIn';
						const fit = sceneFit || (d.imageFit as string) || 'cover';
						const fadeIn = sceneFadeIn !== undefined ? !!sceneFadeIn : !!d.imageFadeIn;
						const fadeOut = sceneFadeOut !== undefined ? !!sceneFadeOut : !!d.imageFadeOut;

						// Per-item text overrides
						const fontFamily = getVal(scene, ['fontFamily'], d.fontFamily) || 'Inter';
						const fontSize = Number(getVal(scene, ['fontSize'], d.fontSize)) || 36;
						const fontColor = getVal(scene, ['fontColor'], d.fontColor) || '#FFFFFF';
						const fontWeight = Number(getVal(scene, ['fontWeight'], d.fontWeight)) || 400;
						const background = getVal(scene, ['background'], d.background) || 'rgba(0,0,0,0.3)';
						const captionStyle = getVal(scene, ['captionStyle'], d.captionStyle) || 'tiktok';
						const combineMs = Number(getVal(scene, ['combineMs'], d.combineMs)) || 400;
						const textAnimation = getVal(scene, ['textAnimation'], d.textAnimation) || 'none';
						const vertical = getVal(scene, ['vertical'], d.vertical) || 'bottom';
						const horizontal = getVal(scene, ['horizontal'], d.horizontal) || 'center';

						// Build single-scene Remotion payload
						const tracks: IDataObject[] = [];

						if (imageUrl) {
							const imageClip: IDataObject = {
								asset: { type: 'image', src: imageUrl },
								start: 0,
								length: duration,
								fit,
								effect,
							};
							if (fadeIn || fadeOut) {
								imageClip.transition = {};
								if (fadeIn) (imageClip.transition as IDataObject).in = 'fade';
								if (fadeOut) (imageClip.transition as IDataObject).out = 'fade';
							}
							tracks.push({ clips: [imageClip] });
						}

						if (caption) {
							const textAsset: IDataObject = {
								type: 'text',
								text: caption,
								font: { family: fontFamily, size: fontSize, color: fontColor, weight: fontWeight },
								alignment: { horizontal, vertical },
								background,
							};
							if (captionStyle === 'tiktok') {
								textAsset.captionStyle = 'tiktok';
								textAsset.combineMs = combineMs;
							}
							const textClip: IDataObject = {
								asset: textAsset,
								start: 0,
								length: duration,
							};
							if (textAnimation && textAnimation !== 'none') {
								textClip.textAnimation = textAnimation;
							}
							tracks.push({ clips: [textClip] });
						}

						if (audioUrl) {
							tracks.push({
								clips: [{
									asset: { type: 'audio', src: audioUrl },
									start: 0,
									length: duration,
								}],
							});
						}

						const payload = {
							timeline: { tracks },
							output: { format: 'mp4', resolution, fps },
						};

						// Send render request
						const renderRes = await remotionApiRequest.call(
							this, 'POST', '/edit/v1/render',
							payload as unknown as IDataObject,
						) as IDataObject;

						if (!renderRes?.success) {
							throw new NodeOperationError(
								this.getNode(),
								`Scene ${sceneNum} render rejected: ${JSON.stringify(renderRes)}`,
							);
						}

						const renderId = (renderRes.response as IDataObject)?.id as string;
						if (!renderId) {
							throw new NodeOperationError(this.getNode(), `No render ID for scene ${sceneNum}`);
						}

						// Poll until done
						const pollResult = await pollRender.call(this, renderId, baseUrl);
						const videoUrl = pollResult.videoUrl as string;

						if (!videoUrl) {
							throw new NodeOperationError(this.getNode(), `No video URL for scene ${sceneNum}`);
						}

						// Download the scene video (full URL, avoid remotionApiRequest URL doubling)
						const downloadRes = await this.helpers.request({
							method: 'GET',
							url: videoUrl,
							json: false,
							encoding: null,
						});
						const videoBuffer = downloadRes;
						const safeName = `scene_${String(sceneNum).padStart(3, '0')}.mp4`;
						const outPath = path.join(tempDir, safeName);
						fs.writeFileSync(outPath, Buffer.from(videoBuffer as any));
						sceneFiles.push(outPath);
					}

					if (sceneFiles.length === 0) {
						throw new NodeOperationError(this.getNode(), 'No scenes rendered');
					}

					// Concat all scene videos with ffmpeg
					const listPath = path.join(tempDir, 'files.txt');
					const listContent = sceneFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
					fs.writeFileSync(listPath, listContent);

					const finalPath = path.join(tempDir, 'final.mp4');
					try {
						execSync(
							`ffmpeg -f concat -safe 0 -i "${listPath}" -c copy "${finalPath}"`,
							{ stdio: 'pipe', timeout: 60000 },
						);
					} catch (ffmpegErr: any) {
						throw new NodeOperationError(
							this.getNode(),
							`ffmpeg concat failed: ${ffmpegErr.message || ffmpegErr}`,
						);
					}

					// Read final video and return as binary data (NO internal upload)
					const finalBuf = fs.readFileSync(finalPath);
					const finalName = `batch_${Date.now()}.mp4`;

					returnData.push({
						json: {
							status: 'done',
							scenesProcessed: items.length,
							fileName: finalName,
						} as IDataObject,
						binary: {
							data: {
								mimeType: 'video/mp4',
								data: finalBuf.toString('base64'),
								fileName: finalName,
							},
						},
					});
				} finally {
					// Cleanup temp files
					try {
						fs.rmSync(tempDir, { recursive: true, force: true });
					} catch {
						// ignore cleanup errors
					}
				}
			} catch (error: any) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: error.message,
							errorDetails: error.description || '',
						} as IDataObject,
					});
				} else {
					throw error;
				}
			}

			return [returnData];
		}

		// ---- MANUAL mode (per-item processing) ----
		for (let i = 0; i < items.length; i++) {
			try {
				let images: IDataObject[] = [];
				let texts: IDataObject[] = [];
				let audios: IDataObject[] = [];
				let soundtrack: IDataObject | null = null;
				let resolution = '1080';
				let fps = 25;

				// Read from manual fields
				const imagesParam = this.getNodeParameter('images', i, {}) as IDataObject;
				const textsParam = this.getNodeParameter('texts', i, {}) as IDataObject;
				const audiosParam = this.getNodeParameter('audios', i, {}) as IDataObject;
				const soundtrackParam = this.getNodeParameter('soundtrack', i, {}) as IDataObject;
				const outputSettings = this.getNodeParameter('outputSettings', i, {}) as IDataObject;

				images = (imagesParam.image as IDataObject[]) || [];
				texts = (textsParam.text as IDataObject[]) || [];
				audios = (audiosParam.audio as IDataObject[]) || [];

				const trackArr = (soundtrackParam.track as IDataObject[]) || [];
				if (trackArr.length > 0 && trackArr[0].src) {
					soundtrack = {
						src: trackArr[0].src,
						volume: Number(trackArr[0].volume) || 0.15,
					};
				}

				const settingsArr = (outputSettings.settings as IDataObject[]) || [];
				if (settingsArr.length > 0) {
					resolution = (settingsArr[0].resolution as string) || '1080';
					fps = Number(settingsArr[0].fps) || 25;
				}

				// Calculate total duration
				const allClips = [...images, ...texts, ...audios];
				const totalDuration = allClips.reduce((max, c) => {
					const start = Number(c.start) || 0;
					const length = Number(c.length) || 5;
					return Math.max(max, start + length);
				}, 0) || 5;

				// Build timeline structure
				const tracks: IDataObject[] = [];

				if (images.length) {
					tracks.push({
						clips: images.map((img) => {
							const clip: IDataObject = {
								asset: { type: 'image', src: img.src },
								start: Number(img.start) || 0,
								length: Number(img.length) || totalDuration,
								fit: (img.fit as string) || 'cover',
							};
							const effect = img.effect as string;
							if (effect) clip.effect = effect;
							const fadeIn = !!(img.fadeIn || (img.transition as IDataObject)?.in === 'fade');
							const fadeOut = !!(img.fadeOut || (img.transition as IDataObject)?.out === 'fade');
							if (fadeIn || fadeOut) {
								clip.transition = {};
								if (fadeIn) (clip.transition as IDataObject).in = 'fade';
								if (fadeOut) (clip.transition as IDataObject).out = 'fade';
							}
							return clip;
						}),
					});
				}

				if (texts.length) {
					tracks.push({
						clips: texts.map((txt) => {
							const asset: IDataObject = {
								type: 'text',
								text: txt.text || '',
								font: {
									family: (txt.fontFamily as string) || 'Inter',
									size: Number(txt.fontSize) || 36,
									color: (txt.fontColor as string) || '#FFFFFF',
									weight: Number(txt.fontWeight) || 400,
								},
								alignment: {
									horizontal: (txt.horizontal as string) || 'center',
									vertical: (txt.vertical as string) || 'bottom',
								},
								background: (txt.background as string) || 'rgba(0,0,0,0.3)',
							};
							const capStyle = txt.captionStyle as string;
							if (capStyle && capStyle !== 'static') {
								asset.captionStyle = capStyle;
							}
							const combineMs = txt.combineMs as number;
							if (combineMs) {
								asset.combineMs = Number(combineMs);
							}
							const clip: IDataObject = {
								asset,
								start: Number(txt.start) || 0,
								length: Number(txt.length) || totalDuration,
							};
							const anim = txt.textAnimation as string;
							if (anim && anim !== 'none') {
								clip.textAnimation = anim;
							}
							return clip;
						}),
					});
				}

				if (audios.length) {
					tracks.push({
						clips: audios.map((a) => ({
							asset: { type: 'audio', src: a.src },
							start: Number(a.start) || 0,
							length: Number(a.length) || totalDuration,
						})),
					});
				}

				const timeline: IDataObject = { tracks };

				if (soundtrack?.src) {
					timeline.soundtrack = {
						src: soundtrack.src,
						volume: Number(soundtrack.volume) || 0.15,
					};
				}

				const payload = {
					timeline,
					output: {
						format: 'mp4',
						resolution,
						fps,
					},
				};

				// POST render request
				const renderResponse = (await remotionApiRequest.call(
					this,
					'POST',
					'/edit/v1/render',
					payload as unknown as IDataObject,
				)) as IDataObject;

				if (!renderResponse?.success) {
					throw new NodeOperationError(
						this.getNode(),
						`Render API rejected: ${JSON.stringify(renderResponse)}`,
					);
				}

				const responseData = renderResponse.response as IDataObject;
				const renderId = responseData?.id as string;

				if (!renderId) {
					throw new NodeOperationError(
						this.getNode(),
						`No render ID returned: ${JSON.stringify(renderResponse)}`,
					);
				}

				// Poll until done
				const pollResult = await pollRender.call(this, renderId, baseUrl);

				returnData.push({ json: pollResult as IDataObject });
			} catch (error: any) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: error.message,
							errorDetails: error.description || '',
						},
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
