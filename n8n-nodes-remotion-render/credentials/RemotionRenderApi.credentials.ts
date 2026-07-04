import { ICredentialType, INodeProperties } from 'n8n-workflow';

export class RemotionRenderApi implements ICredentialType {
	name = 'remotionRenderApi';
	displayName = 'Remotion Render API - mimnets';
	documentationUrl = 'https://github.com/mimnets/n8n-qdrant-starter';
	properties: INodeProperties[] = [
		{
			displayName: 'Server URL',
			name: 'serverUrl',
			type: 'string',
			default: 'http://remotion:3000',
			placeholder: 'http://remotion:3000',
			description:
				'Base URL of your Remotion render server (e.g., http://remotion:3000 or http://your-server-ip:3000)',
			required: true,
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'Optional API key if your Remotion server requires authentication',
			required: false,
		},
	];
}
