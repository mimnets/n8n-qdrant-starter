import {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';
import { remotionApiRequest, pollRender } from './GenericFunctions';

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
			// INPUT SOURCE — "Manual" or "From Input JSON"
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

			// ================================================================
			// IMAGES — fixedCollection, multipleValues
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
			// TEXTS — fixedCollection, multipleValues
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
			// AUDIO CLIPS — fixedCollection, multipleValues
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
			// SOUNDTRACK
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
			// OUTPUT SETTINGS
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
		for (let i = 0; i < items.length; i++) {
			try {
				const inputSource = this.getNodeParameter('inputSource', i, 'manual') as string;

				// ----------------------------------------------------------------
				// Build timeline from either Input JSON or Manual fields
				// ----------------------------------------------------------------
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

				// Calculate total duration from all clips
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
							// TikTok captions style
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
							// Text animation
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

				// ----------------------------------------------------------------
				// POST render request
				// ----------------------------------------------------------------
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

				// ----------------------------------------------------------------
				// Poll until done (blocking — runs inside this Code node)
				// ----------------------------------------------------------------
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
