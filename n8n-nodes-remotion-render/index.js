const { RemotionRender } = require('./dist/nodes/RemotionRender/RemotionRender.node.js');
const { RemotionRenderApi } = require('./dist/credentials/RemotionRenderApi.credentials.js');

module.exports = {
	nodeTypes: {
		remotionRender: RemotionRender,
	},
	credentialTypes: {
		remotionRenderApi: RemotionRenderApi,
	},
};
