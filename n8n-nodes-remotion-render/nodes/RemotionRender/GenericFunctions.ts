import { IExecuteFunctions, IDataObject, NodeOperationError } from 'n8n-workflow';

/**
 * Make a request to the Remotion render server.
 */
export async function remotionApiRequest(
	this: IExecuteFunctions,
	method: string,
	path: string,
	body: IDataObject | string = {},
	query: IDataObject = {},
): Promise<any> {
	const credentials = await this.getCredentials('remotionRenderApi');
	let baseUrl = (credentials.serverUrl as string) || '';
	baseUrl = baseUrl.replace(/\/+$/, '');

	// Auto-add protocol if missing
	if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
		baseUrl = `http://${baseUrl}`;
	}

	// Fallback to Docker container name
	if (!baseUrl) {
		baseUrl = 'http://remotion:3000';
	}

	const apiKey = (credentials.apiKey as string) || '';

	const requestUrl = `${baseUrl}${path}`;

	const options: any = {
		method,
		headers: {
			'Content-Type': 'application/json',
		},
		uri: requestUrl,
		qs: query,
		json: true,
	};

	if (apiKey) {
		options.headers['Authorization'] = `Bearer ${apiKey}`;
	}

	if (body && Object.keys(typeof body === 'string' ? {} : body).length > 0) {
		options.body = body;
	}

	// Remove empty query string
	if (Object.keys(query).length === 0) {
		delete options.qs;
	}

	try {
		return await this.helpers.request(options);
	} catch (error: any) {
		throw new NodeOperationError(
			this.getNode(),
			`Remotion server error: ${error.message} (url: ${requestUrl})`,
		);
	}
}

/**
 * Poll render status until done or timeout.
 * Blocks until the video is ready.
 */
export async function pollRender(
	this: IExecuteFunctions,
	renderId: string,
	baseUrl: string,
	maxAttempts = 150,
): Promise<IDataObject> {
	for (let i = 0; i < maxAttempts; i++) {
		await new Promise((resolve) => setTimeout(resolve, 2000));

		const response = await remotionApiRequest.call(
			this,
			'GET',
			`/edit/v1/render/${renderId}`,
		);

		const data = response as IDataObject;

		if (!data?.success) {
			throw new NodeOperationError(
				this.getNode(),
				`Poll failed: ${JSON.stringify(data)}`,
			);
		}

		const responseData = data.response as IDataObject | undefined;
		const status = responseData?.status as string;

		if (status === 'done') {
			const videoPath = responseData?.url as string;
			const cleanBase = baseUrl.replace(/\/+$/, '');
			return {
				renderId,
				status: 'done',
				videoUrl: videoPath ? `${cleanBase}${videoPath}` : null,
				downloadUrl: videoPath ? `${cleanBase}${videoPath}` : null,
				pollsNeeded: i + 1,
			};
		}

		if (status === 'failed' || status === 'error') {
			throw new NodeOperationError(
				this.getNode(),
				`Render failed: ${(responseData?.error as string) || 'unknown error'}`,
			);
		}
	}

	throw new NodeOperationError(
		this.getNode(),
		`Render timed out after ${maxAttempts} polls (renderId: ${renderId})`,
	);
}
