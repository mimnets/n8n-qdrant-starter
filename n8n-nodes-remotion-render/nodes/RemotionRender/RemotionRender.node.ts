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
// Types
// -------------------------------------------------------------------
interface DetectedAsset {
	type: 'image' | 'audio' | 'text' | 'soundtrack';
	src?: string;
	text?: string;
	meta: IDataObject;
}

// -------------------------------------------------------------------
// Detection helpers
// -------------------------------------------------------------------

/** Known keys that strongly suggest an item IS an image */
const IMAGE_KEYS = new Set([
	'image', 'image_url', 'imageUrl', 'img', 'photo', 'photo_url', 'photoUrl',
	'thumbnail', 'thumbnail_url', 'thumbnailUrl',
]);

/** Known keys that strongly suggest an item IS an audio clip */
const AUDIO_KEYS = new Set([
	'audio', 'audio_url', 'audioUrl', 'voice', 'voice_url', 'voiceUrl',
	'voiceover', 'voice_over', 'voiceOver', 'clip',
]);

/** Known keys that strongly suggest background music */
const SOUNDTRACK_KEYS = new Set([
	'soundtrack', 'bgm', 'background_music', 'backgroundMusic',
	'music', 'music_url', 'musicUrl',
]);

/** Known keys that strongly suggest a text overlay */
const TEXT_KEYS = new Set([
	'text', 'caption', 'title', 'headline', 'subtitle', 'overlay',
	'label', 'description',
]);

/** File extensions that indicate image */
const IMAGE_EXTENSIONS = new Set([
	'.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp', '.svg',
]);

/** File extensions that indicate audio */
const AUDIO_EXTENSIONS = new Set([
	'.mp3', '.wav', '.ogg', '.aac', '.m4a', '.flac', '.wma', '.opus',
]);

function getExtensionLower(url: string): string {
	try {
		const pathname = new URL(url).pathname;
		const dot = pathname.lastIndexOf('.');
		return dot >= 0 ? pathname.slice(dot).toLowerCase() : '';
	} catch {
		const dot = url.lastIndexOf('.');
		return dot >= 0 ? url.slice(dot).toLowerCase() : '';
	}
}

function hasKey(item: IDataObject, keys: Set<string>): string | null {
	for (const k of Object.keys(item)) {
		if (keys.has(k)) return k;
	}
	return null;
}

function isDefined(val: unknown): boolean {
	return val !== undefined && val !== null && val !== '';
}

/**
 * Classify a single upstream item into one or more asset types.
 * Returns an array because a single item could contain both an image url
 * and a text caption (e.g. a social media post).
 */
function classifyItem(item: IDataObject): DetectedAsset[] {
	const results: DetectedAsset[] = [];

	// If the item has a `type` field that tells us directly
	const explicitType = item.type as string | undefined;
	if (explicitType) {
		const t = explicitType.toLowerCase();
		if (t === 'image' || t === 'photo') {
			const src = (item.url || item.src || item.image_url || item.imageUrl) as string;
			if (isDefined(src)) {
				results.push({ type: 'image', src: String(src), meta: { ...item } });
				return results; // explicit type → don't also classify as other things
			}
		}
		if (t === 'audio' || t === 'voice' || t === 'voiceover') {
			const src = (item.url || item.src || item.audio_url || item.audioUrl) as string;
			if (isDefined(src)) {
				results.push({ type: 'audio', src: String(src), meta: { ...item } });
				return results;
			}
		}
		if (t === 'soundtrack' || t === 'bgm' || t === 'music') {
			const src = (item.url || item.src) as string;
			if (isDefined(src)) {
				results.push({ type: 'soundtrack', src: String(src), meta: { ...item } });
				return results;
			}
		}
		if (t === 'text' || t === 'caption' || t === 'subtitle') {
			const txt = (item.text || item.caption || item.content) as string;
			if (isDefined(txt)) {
				results.push({ type: 'text', text: String(txt), meta: { ...item } });
				return results;
			}
		}
		// Unknown type — fall through to auto-detection
	}

	// Check if item is a soundtrack candidate (special keys)
	const soundtrackKey = hasKey(item, SOUNDTRACK_KEYS);
	if (soundtrackKey) {
		const val = item[soundtrackKey];
		if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
			results.push({ type: 'soundtrack', src: String((val as IDataObject).src || (val as IDataObject).url || ''), meta: val as IDataObject });
			return results;
		}
		if (typeof val === 'string') {
			results.push({ type: 'soundtrack', src: val, meta: { src: val } });
			return results;
		}
	}

	// Collect url/src candidates
	const urlCandidates: string[] = [];
	const url = item.url as string;
	const src = item.src as string;
	if (isDefined(url)) urlCandidates.push(String(url));
	if (isDefined(src) && src !== url) urlCandidates.push(String(src));

	// Also check known key aliases
	const imageKey = hasKey(item, IMAGE_KEYS);
	if (imageKey) {
		const val = item[imageKey];
		if (typeof val === 'string') urlCandidates.push(val);
	}
	const audioKey = hasKey(item, AUDIO_KEYS);
	if (audioKey && !audioKey.startsWith('image')) {
		const val = item[audioKey];
		if (typeof val === 'string' && !urlCandidates.includes(val)) urlCandidates.push(val);
	}

	// Classify each url by extension
	for (const candidateUrl of urlCandidates) {
		const ext = getExtensionLower(candidateUrl);
		if (IMAGE_EXTENSIONS.has(ext)) {
			// Already has this url as image? skip duplicate
			if (!results.some(r => r.type === 'image' && r.src === candidateUrl)) {
				results.push({ type: 'image', src: candidateUrl, meta: { ...item } });
			}
		} else if (AUDIO_EXTENSIONS.has(ext)) {
			if (!results.some(r => r.type === 'audio' && r.src === candidateUrl)) {
				results.push({ type: 'audio', src: candidateUrl, meta: { ...item } });
			}
		} else {
			// Unknown extension — guess by key name
			if (imageKey && results.length === 0) {
				results.push({ type: 'image', src: candidateUrl, meta: { ...item } });
			} else if (audioKey && !results.some(r => r.type === 'audio')) {
				results.push({ type: 'audio', src: candidateUrl, meta: { ...item } });
			}
		}
	}

	// Check for text content
	const textKey = hasKey(item, TEXT_KEYS);
	if (textKey) {
		const txt = item[textKey] as string;
		if (isDefined(txt)) {
			results.push({ type: 'text', text: String(txt), meta: { ...item } });
		}
	}

	// Check for content_type / mime hints
	const contentType = (item.content_type || item.mime_type || item.mime) as string | undefined;
	if (contentType && results.length === 0) {
		const ct = contentType.toLowerCase();
		if (ct.startsWith('image/')) {
			const candidate = (url || item.src || '') as string;
			if (isDefined(candidate)) results.push({ type: 'image', src: String(candidate), meta: { ...item } });
		} else if (ct.startsWith('audio/')) {
			const candidate = (url || item.src || '') as string;
			if (isDefined(candidate)) results.push({ type: 'audio', src: String(candidate), meta: { ...item } });
		}
	}

	return results;
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
			// INPUT SOURCE — "Manual", "From Input JSON", or "Auto Collect"
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
						name: 'From Input JSON — use upstream data',
						value: 'inputJson',
						description:
							'Read images[], texts[], audios[] from the previous node\'s output JSON',
					},
					{
						name: 'Auto Collect — detect all upstream items',
						value: 'autoCollect',
						description:
							'Collect all incoming items, detect images/audios/texts automatically, and build the timeline',
					},
					{
						name: '⭐ Sequence Combiner — combine multiple items into one video',
						value: 'sequenceCombiner',
						description:
							'Treat each upstream item as ONE scene. Perfect for SplitInBatches Done output. Map your fields below.',
					},
				],
				default: 'manual',
				displayOptions: {
					show: { operation: ['render'] },
				},
				description: 'How to provide the timeline data for rendering',
			},

			// ---- Input JSON note ----
			{
				displayName:
					'The node will read the following keys from the upstream JSON:\n\n- <strong>images</strong>: [{ src, start, length, effect, fit }]\n- <strong>texts</strong>: [{ text, start, length, vertical, horizontal, fontSize, fontColor, fontFamily }]\n- <strong>audios</strong>: [{ src, start, length }]\n- <strong>soundtrack</strong>: { src, volume }\n- <strong>resolution</strong>: "1080"\n- <strong>fps</strong>: 25\n\nAll fields are optional. Connect a Code node or any upstream node that outputs this structure.',
				name: 'inputJsonNote',
				type: 'notice',
				displayOptions: {
					show: { operation: ['render'], inputSource: ['inputJson'] },
				},
				default: '',
			},

			// ---- Combine multiple items toggle ----
			{
				displayName:
					'⭐ Combine Multiple Items into Sequence',
				name: 'combineItems',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: { operation: ['render'], inputSource: ['inputJson'] },
				},
				description:
					'When enabled, ALL upstream items are combined into ONE video. Each item = one scene with imageUrl, audioUrl, voiceOver, duration.',
			},

			// ---- Combine items note ----
			{
				displayName:
					'Each upstream item should have:\n• imageUrl or url → image\n• audioUrl → audio clip\n• voiceOver or voice_over → text caption\n• duration (seconds) → scene length\n\nItems are sequenced automatically from first to last.',
				name: 'combineItemsNote',
				type: 'notice',
				displayOptions: {
					show: { operation: ['render'], inputSource: ['inputJson'], combineItems: [true] },
				},
				default: '',
			},

			// ================================================================
			// SEQUENCE COMBINER — Field mapping & options
			// ================================================================
			{
				displayName:
					'Each upstream item = one scene. Fields auto-detect these keys, or type your own:',
				name: 'seqCombinerNote',
				type: 'notice',
				displayOptions: {
					show: { operation: ['render'], inputSource: ['sequenceCombiner'] },
				},
				default: '',
			},
			{
				displayName: 'Image Field',
				name: 'imageField',
				type: 'string',
				displayOptions: {
					show: { operation: ['render'], inputSource: ['sequenceCombiner'] },
				},
				default: 'imageUrl',
				description:
					'Field name for image URL. Also checks: url, src, img_url, image_url, photo',
				placeholder: 'imageUrl',
			},
			{
				displayName: 'Audio Field',
				name: 'audioField',
				type: 'string',
				displayOptions: {
					show: { operation: ['render'], inputSource: ['sequenceCombiner'] },
				},
				default: 'audioUrl',
				description:
					'Field name for audio URL. Also checks: audio_url, voice, voice_url, clip',
				placeholder: 'audioUrl',
			},
			{
				displayName: 'Text / Caption Field',
				name: 'textField',
				type: 'string',
				displayOptions: {
					show: { operation: ['render'], inputSource: ['sequenceCombiner'] },
				},
				default: 'voiceOver',
				description:
					'Field name for text overlay. Also checks: voice_over, Voiceover_Text, text, caption, title',
				placeholder: 'voiceOver',
			},
			{
				displayName: 'Duration Field',
				name: 'durationField',
				type: 'string',
				displayOptions: {
					show: { operation: ['render'], inputSource: ['sequenceCombiner'] },
				},
				default: 'duration',
				description:
					'Field name for scene duration in seconds. Also checks: length, video_length, time',
				placeholder: 'duration',
			},
			{
				displayName: 'Default Duration (seconds)',
				name: 'defaultDuration',
				type: 'number',
				displayOptions: {
					show: { operation: ['render'], inputSource: ['sequenceCombiner'] },
				},
				default: 5,
				typeOptions: { minValue: 1, maxValue: 60 },
				description: 'Used when no duration field is found on an item',
			},
			{
				displayName: 'Resolution',
				name: 'combinerResolution',
				type: 'options',
				displayOptions: {
					show: { operation: ['render'], inputSource: ['sequenceCombiner'] },
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
					show: { operation: ['render'], inputSource: ['sequenceCombiner'] },
				},
				default: 30,
				typeOptions: { minValue: 1, maxValue: 60 },
				description: 'Frames per second',
			},

			// ---- Auto Collect note ----
			{
				displayName:
					'All items from the previous node are collected automatically. The node detects each item by:\n\n' +
					'• <strong>Explicit "type" field</strong>: set type to "image", "audio", "text", or "soundtrack"\n' +
					'• <strong>File extension</strong>: .jpg/.png/.webp → image, .mp3/.wav/.ogg → audio\n' +
					'• <strong>Key names</strong>: url/src + image key → image, soundtrack/bgm key → soundtrack\n' +
					'• <strong>text/caption</strong> key → text overlay\n' +
					'• <strong>content_type/mime</strong> field\n\n' +
					'<strong>Auto-timeline:</strong> Each image gets a default duration. Voice-over audios align with images by index. Adjust defaults below.',
				name: 'autoCollectNote',
				type: 'notice',
				displayOptions: {
					show: { operation: ['render'], inputSource: ['autoCollect'] },
				},
				default: '',
			},

			// ---- Auto Collect defaults ----
			{
				displayName: 'Auto Collect Defaults',
				name: 'autoCollectDefaults',
				placeholder: 'Defaults',
				type: 'fixedCollection',
				displayOptions: {
					show: { operation: ['render'], inputSource: ['autoCollect'] },
				},
				default: {},
				options: [
					{
						name: 'defaults',
						displayName: 'Defaults',
						values: [
							{
								displayName: 'Image Duration (seconds)',
								name: 'imageDuration',
								type: 'number',
								default: 4,
								typeOptions: { minValue: 1, maxValue: 60 },
								description: 'How long each auto-detected image stays on screen',
							},
							{
								displayName: 'Image Effect',
								name: 'imageEffect',
								type: 'options',
								options: [
									{ name: 'None', value: '' },
									{ name: 'Fade', value: 'fade', description: 'Fade in / fade out' },
									{ name: 'Zoom In', value: 'zoomIn' },
									{ name: 'Zoom Out', value: 'zoomOut' },
									{ name: 'Slide Left', value: 'slideLeft' },
									{ name: 'Slide Right', value: 'slideRight' },
									{ name: 'Slide Up', value: 'slideUp' },
									{ name: 'Slide Down', value: 'slideDown' },
								],
								default: 'fade',
								description: 'Default animation effect for auto-detected images',
							},
							{
								displayName: 'Image Fit',
								name: 'imageFit',
								type: 'options',
								options: [
									{ name: 'Contain (fit inside)', value: 'contain' },
									{ name: 'Cover (fill & crop)', value: 'cover' },
									{ name: 'Fill (stretch)', value: 'fill' },
								],
								default: 'contain',
								description: 'How images fit the frame',
							},
							{
								displayName: 'Audio Align Mode',
								name: 'audioAlign',
								type: 'options',
								options: [
									{
										name: 'By Index — align with images',
										value: 'index',
										description: 'First audio plays with first image, second with second, etc.',
									},
									{
										name: 'All at Start — play simultaneously',
										value: 'allStart',
										description: 'All audio clips start at frame 0 (for simultaneous playback)',
									},
								],
								default: 'index',
								description: 'How auto-detected audio clips are positioned in the timeline',
							},
							{
								displayName: 'Text Vertical',
								name: 'textVertical',
								type: 'options',
								options: [
									{ name: 'Top', value: 'top' },
									{ name: 'Center', value: 'center' },
									{ name: 'Bottom', value: 'bottom' },
								],
								default: 'bottom',
								description: 'Default vertical position for auto-detected text overlays',
							},
							{
								displayName: 'Text Font Size',
								name: 'textFontSize',
								type: 'number',
								default: 40,
								typeOptions: { minValue: 12, maxValue: 200 },
								description: 'Default font size for auto-detected text overlays',
							},
							{
								displayName: 'Text Font Color',
								name: 'textFontColor',
								type: 'color',
								default: '#FFFFFF',
								description: 'Default text color',
							},
							{
								displayName: 'Soundtrack Volume',
								name: 'soundtrackVolume',
								type: 'number',
								default: 0.15,
								typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
								description: 'Default volume for auto-detected soundtrack',
							},
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
								typeOptions: { minValue: 1, maxValue: 60 },
								description: 'Frames per second',
							},
						],
					},
				],
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
		// We process items in bulk for autoCollect (single render from all items)
		// or per-item for manual/inputJson
		const inputSource = this.getNodeParameter('inputSource', 0, 'manual') as string;

		if (inputSource === 'sequenceCombiner') {
			// ----------------------------------------------------------------
			// SEQUENCE COMBINER — each item = one scene, combine into one video
			// ----------------------------------------------------------------
			try {
				const imageField = this.getNodeParameter('imageField', 0, 'imageUrl') as string;
				const audioField = this.getNodeParameter('audioField', 0, 'audioUrl') as string;
				const textField = this.getNodeParameter('textField', 0, 'voiceOver') as string;
				const durationField = this.getNodeParameter('durationField', 0, 'duration') as string;
				const defaultDuration = this.getNodeParameter('defaultDuration', 0, 5) as number;
				const resolution = this.getNodeParameter('combinerResolution', 0, 'vertical') as string;
				const fps = this.getNodeParameter('combinerFps', 0, 30) as number;

				// Fallback field names to check when the configured field is empty
				const imageFallbacks = ['imageUrl', 'url', 'src', 'img_url', 'image_url', 'photo'];
				const audioFallbacks = ['audioUrl', 'audio_url', 'voice', 'voice_url', 'clip'];
				const textFallbacks = ['voiceOver', 'voice_over', 'Voiceover_Text', 'text', 'caption', 'title'];
				const durationFallbacks = ['duration', 'length', 'video_length', 'time'];

				function getField(item: IDataObject, field: string, fallbacks: string[], defaultVal: any): any {
					const keys = [field, ...fallbacks.filter(f => f !== field)];
					for (const k of keys) {
						const val = item[k];
						if (val !== undefined && val !== null && val !== '') return val;
					}
					return defaultVal;
				}

				let currentStart = 0;
				const images: IDataObject[] = [];
				const audios: IDataObject[] = [];
				const texts: IDataObject[] = [];

				for (let i = 0; i < items.length; i++) {
					const item = items[i]?.json as IDataObject;

					const imageUrl = getField(item, imageField, imageFallbacks, '');
					const audioUrl = getField(item, audioField, audioFallbacks, '');
					const textVal = getField(item, textField, textFallbacks, '');
					const duration = Number(getField(item, durationField, durationFallbacks, defaultDuration)) || defaultDuration;

					if (imageUrl) {
						images.push({ src: String(imageUrl), start: currentStart, length: duration });
					}
					if (audioUrl) {
						audios.push({ src: String(audioUrl), start: currentStart, length: duration });
					}
					if (textVal) {
						texts.push({
							text: String(textVal),
							start: currentStart,
							length: duration,
							vertical: 'bottom',
							fontSize: 36,
							fontColor: '#FFFFFF',
						});
					}

					currentStart += duration;
				}

				// Build timeline
				const allClips = [...images, ...texts, ...audios];
				const totalDuration = allClips.reduce((max, c) => {
					return Math.max(max, (Number(c.start) || 0) + (Number(c.length) || 5));
				}, 0) || 5;

				const tracks: IDataObject[] = [];

				if (images.length) {
					tracks.push({
						clips: images.map((img) => ({
							asset: { type: 'image', src: img.src },
							start: Number(img.start) || 0,
							length: Number(img.length) || totalDuration,
							fit: (img.fit as string) || 'cover',
						})),
					});
				}

				if (texts.length) {
					tracks.push({
						clips: texts.map((txt) => ({
							asset: {
								type: 'text',
								text: txt.text || '',
								font: { family: 'Inter', size: 36, color: '#FFFFFF', weight: 400 },
								alignment: { horizontal: 'center', vertical: 'bottom' },
								background: 'rgba(0,0,0,0.3)',
							},
							start: Number(txt.start) || 0,
							length: Number(txt.length) || totalDuration,
						})),
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
				const payload = { timeline, output: { format: 'mp4', resolution, fps } };

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
				} else {
					throw error;
				}
			}

			return [returnData];
		}

		if (inputSource === 'autoCollect') {
			// ----------------------------------------------------------------
			// AUTO COLLECT MODE — single render from all upstream items
			// ----------------------------------------------------------------
			try {
				const defaultsParam = this.getNodeParameter('autoCollectDefaults', 0, {}) as IDataObject;
				const defaultsArr = (defaultsParam.defaults as IDataObject[]) || [];
				const d = defaultsArr.length > 0 ? defaultsArr[0] : {};

				const imageDuration = Number(d.imageDuration) || 4; // seconds
				const imageEffect = (d.imageEffect as string) || 'fade';
				const imageFit = (d.imageFit as string) || 'contain';
				const audioAlign = (d.audioAlign as string) || 'index';
				const textVertical = (d.textVertical as string) || 'bottom';
				const textFontSize = Number(d.textFontSize) || 40;
				const textFontColor = (d.textFontColor as string) || '#FFFFFF';
				const soundtrackVolume = Number(d.soundtrackVolume) || 0.15;
				const resolution = (d.resolution as string) || '1080';
				const fps = Number(d.fps) || 25;

				// Check if upstream already had a structured payload (detect top-level arrays)
				const firstItem = items[0]?.json as IDataObject;
				const hasStructuredPayload =
					Array.isArray(firstItem?.images) ||
					Array.isArray(firstItem?.texts) ||
					Array.isArray(firstItem?.audios) ||
					typeof firstItem?.soundtrack === 'object';

				let images: IDataObject[] = [];
				let texts: IDataObject[] = [];
				let audios: IDataObject[] = [];
				let soundtrack: IDataObject | null = null;

				if (hasStructuredPayload) {
					// Fallback to inputJson behavior (upstream sent structured array)
					if (Array.isArray(firstItem.images)) images = firstItem.images as IDataObject[];
					if (Array.isArray(firstItem.texts)) texts = firstItem.texts as IDataObject[];
					if (Array.isArray(firstItem.audios)) audios = firstItem.audios as IDataObject[];
					if (typeof firstItem.soundtrack === 'object' && firstItem.soundtrack !== null) {
						soundtrack = firstItem.soundtrack as IDataObject;
					}
				} else {
					// AUTO-DETECT: classify every item, build timeline
					const detectedImages: DetectedAsset[] = [];
					const detectedAudios: DetectedAsset[] = [];
					const detectedTexts: DetectedAsset[] = [];
					let detectedSoundtrack: DetectedAsset | null = null;

					for (const item of items) {
						const assets = classifyItem(item.json as IDataObject);
						for (const asset of assets) {
							if (asset.type === 'image') detectedImages.push(asset);
							else if (asset.type === 'soundtrack') detectedSoundtrack = asset;
							else if (asset.type === 'audio') detectedAudios.push(asset);
							else if (asset.type === 'text') detectedTexts.push(asset);
						}
					}

					if (detectedImages.length === 0 && detectedAudios.length === 0 && detectedTexts.length === 0 && !detectedSoundtrack) {
						// Nothing detected — show a helpful error
						const sampleKeys = items.length > 0
							? Object.keys(items[0].json).slice(0, 6).join(', ')
							: '(no items)';
						throw new NodeOperationError(
							this.getNode(),
							`Auto Collect couldn't detect any images, audios, or text in the incoming data. ` +
							`First item keys: ${sampleKeys}. ` +
							`Either use "Manual" or "From Input JSON" mode, or ensure upstream data has ` +
							`recognizable keys (url, src, text, caption) or file extensions (.jpg, .png, .mp3).`,
						);
					}

					// Convert detection results to timeline items
					// Images: sequential with auto-timing
					const frameDuration = imageDuration * fps;
					images = detectedImages.map((img, i) => ({
						src: img.src,
						start: i * frameDuration / fps, // in seconds
						length: imageDuration,
						effect: imageEffect || undefined,
						fit: imageFit,
						// Pass through metadata from upstream
						...(img.meta.transition ? { transition: img.meta.transition } : {}),
						...(img.meta.fadeIn ? { fadeIn: true } : {}),
						...(img.meta.fadeOut ? { fadeOut: true } : {}),
					}));

					// Audios: by index (align with images) or all at start
					if (audioAlign === 'allStart') {
						audios = detectedAudios.map((a) => ({
							src: a.src,
							start: 0,
							length: imageDuration * Math.max(images.length, 1),
						}));
					} else {
						audios = detectedAudios.map((a, i) => ({
							src: a.src,
							start: (i * frameDuration) / fps,
							length: imageDuration,
						}));
					}

					// Soundtrack
					if (detectedSoundtrack) {
						soundtrack = {
							src: detectedSoundtrack.src,
							volume: soundtrackVolume,
						};
					}

					// Texts: align with images by index
					texts = detectedTexts.map((t, i) => ({
						text: t.text,
						start: (i * frameDuration) / fps,
						length: imageDuration,
						vertical: textVertical,
						horizontal: 'center',
						fontSize: textFontSize,
						fontColor: textFontColor,
						fontFamily: 'Inter',
					}));
				}

				// ----- Build the payload (same as before) -----
				const allClips = [...images, ...texts, ...audios];
				const totalDuration = allClips.reduce((max, c) => {
					const start = Number(c.start) || 0;
					const length = Number(c.length) || 5;
					return Math.max(max, start + length);
				}, 0) || 5;

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

				// POST render
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
				} else {
					throw error;
				}
			}

			return [returnData];
		}

		// ---- MANUAL or INPUT JSON mode (per-item or combined) ----

		// Check if combineItems mode is enabled (multi-scene from multiple upstream items)
		const combineItems = inputSource === 'inputJson'
			? this.getNodeParameter('combineItems', 0, false) as boolean
			: false;

		if (inputSource === 'inputJson' && combineItems && items.length > 1) {
			// ----------------------------------------------------------------
			// COMBINED MODE — multiple items → single video with sequential scenes
			// ----------------------------------------------------------------
			try {
				const combinedImages: IDataObject[] = [];
				const combinedTexts: IDataObject[] = [];
				const combinedAudios: IDataObject[] = [];
				let soundtrack: IDataObject | null = null;
				let resolution = '1080';
				let fps = 25;
				let currentStart = 0;

				for (let i = 0; i < items.length; i++) {
					const item = items[i]?.json as IDataObject;

					// First item may have structured arrays overrides
					if (i === 0) {
						if (Array.isArray(item.images)) {
							// Upstream sent structured arrays → use them directly
							combinedImages.push(...item.images as IDataObject[]);
						}
						if (Array.isArray(item.texts)) {
							combinedTexts.push(...item.texts as IDataObject[]);
						}
						if (Array.isArray(item.audios)) {
							combinedAudios.push(...item.audios as IDataObject[]);
						}
						if (typeof item.soundtrack === 'object') {
							soundtrack = item.soundtrack as IDataObject;
						}
						if (item.resolution) resolution = String(item.resolution);
						if (item.fps) fps = Number(item.fps);
					}

					// Treat each item as ONE scene
					const imageUrl = String(item.imageUrl || item.url || item.img_url || '');
					const audioUrl = String(item.audioUrl || item.audio_url || '');
					const voiceOver = String(item.voiceOver || item.voice_over || item.Voiceover_Text || item.text || item.caption || '');
					const duration = Number(item.duration || item.video_length || 5);

					if (imageUrl) {
						combinedImages.push({ src: imageUrl, start: currentStart, length: duration });
					}
					if (audioUrl) {
						combinedAudios.push({ src: audioUrl, start: currentStart, length: duration });
					}
					if (voiceOver) {
						combinedTexts.push({
							text: voiceOver,
							start: currentStart,
							length: duration,
							vertical: 'bottom',
							fontSize: 36,
							fontColor: '#FFFFFF',
						});
					}

					currentStart += duration;
				}

				// Build and send ONE render with all scenes
				const allClips = [...combinedImages, ...combinedTexts, ...combinedAudios];
				const totalDuration = allClips.reduce((max, c) => {
					const start = Number(c.start) || 0;
					const len = Number(c.length) || 5;
					return Math.max(max, start + len);
				}, 0) || 5;

				const tracks: IDataObject[] = [];

				if (combinedImages.length) {
					tracks.push({
						clips: combinedImages.map((img) => ({
							asset: { type: 'image', src: img.src },
							start: Number(img.start) || 0,
							length: Number(img.length) || totalDuration,
							fit: (img.fit as string) || 'cover',
							effect: (img.effect as string) || undefined,
						})),
					});
				}

				if (combinedTexts.length) {
					tracks.push({
						clips: combinedTexts.map((txt) => ({
							asset: {
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
							},
							start: Number(txt.start) || 0,
							length: Number(txt.length) || totalDuration,
						})),
					});
				}

				if (combinedAudios.length) {
					tracks.push({
						clips: combinedAudios.map((a) => ({
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
					output: { format: 'mp4', resolution, fps },
				};

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
				} else {
					throw error;
				}
			}

			return [returnData];
		}

		// ---- Original per-item processing (manual or non-combined inputJson) ----
		for (let i = 0; i < items.length; i++) {
			try {
				let images: IDataObject[] = [];
				let texts: IDataObject[] = [];
				let audios: IDataObject[] = [];
				let soundtrack: IDataObject | null = null;
				let resolution = '1080';
				let fps = 25;

				if (inputSource === 'inputJson') {
					// Read from upstream node output
					const upstream = items[i]?.json as IDataObject;
					if (upstream.images && Array.isArray(upstream.images)) {
						images = upstream.images as IDataObject[];
					}
					if (upstream.texts && Array.isArray(upstream.texts)) {
						texts = upstream.texts as IDataObject[];
					}
					if (upstream.audios && Array.isArray(upstream.audios)) {
						audios = upstream.audios as IDataObject[];
					}
					if (upstream.soundtrack && typeof upstream.soundtrack === 'object') {
						soundtrack = upstream.soundtrack as IDataObject;
					}
					if (upstream.soundtrackUrl && typeof upstream.soundtrackUrl === 'string') {
						soundtrack = { src: upstream.soundtrackUrl, volume: 0.15 };
					}
					if (upstream.resolution) resolution = String(upstream.resolution);
					if (upstream.fps) fps = Number(upstream.fps);
				} else {
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
