import fs from 'fs';

const mod = {

	_parseHandle: query => {
		const { resource } = Object.fromEntries(new URLSearchParams(query));

		if (!resource)
			return null;

		const account = Object.fromEntries([resource.split(':').slice(0, 2)]).acct;

		if (!account)
			return null;

		return account.split('@').shift();
	},

  _parseToken: e => (!e || !e.trim()) ? null : e.split('Bearer ').pop(),

  _parseScopes: e => Object.fromEntries(e.split(/\s+/).map(e => e.split(':'))),

	options: () => (req, res, next) => {
		res.set({
			'Access-Control-Allow-Origin': req.headers['origin'] || '*',
			'Access-Control-Expose-Headers': 'Content-Length, Content-Type, ETag',
			'Cache-control': 'no-cache',
		});

		if (req.method === 'OPTIONS')
			return res.set({
				'Access-Control-Allow-Methods': 'OPTIONS, GET, HEAD, PUT, DELETE',
				'Access-Control-Allow-Headers': 'Authorization, Content-Length, Content-Type, If-Match, If-None-Match, Origin, X-Requested-With',				
			}).status(204).end();

		return next();
	},

	webfinger: ({ prefix }) => (req, res, next) => {
		if (!req.url.toLowerCase().match('/.well-known/webfinger'))
			return next();

		const base = `${ req.protocol }://${ req.get('host') }`;
		
		const handle = mod._parseHandle(req.query);

		if (!handle)
			return next();

		return res.json({
			links: [{
				rel: 'http://tools.ietf.org/id/draft-dejong-remotestorage',
				href: `${ base }/${ prefix }/${ handle }`,
				properties: {
					'http://remotestorage.io/spec/version': 'draft-dejong-remotestorage-11',
					'http://tools.ietf.org/html/rfc6749#section-4.2': `${ base }/oauth`,
				},
			}],
		});
	},

	storage: ({ prefix, storage, getScope }) => async (req, res, next) => {
		// console.info(req.method, req.url);
		const [handle, publicFolder, _url] = req.url.match(new RegExp(`^\\/(\\w+)(\\/public)?(.*)`)).slice(1);
		const token = mod._parseToken(req.headers.authorization);

		if (!publicFolder && !token)
			return res.status(401).end();

		const isFolderRequest = req.url.endsWith('/');

		const scope = await getScope(handle, token);

		if (!scope && publicFolder && isFolderRequest)
			return res.status(401).end();

		if (!scope && !publicFolder)
			return res.status(401).end();

		const _scope = _url === '/' ? '*' : _url.match(/^\/([^\/]+)/).pop();
		
		if (!publicFolder && scope && !Object.keys(mod._parseScopes(scope)).includes(_scope))
			return res.status(401).end();

		if (['PUT', 'DELETE'].includes(req.method) && (!scope || !mod._parseScopes(scope)[_scope].includes('w')))
			return res.status(401).end();

		if (req.method === 'PUT' && req.headers['content-range'])
				return res.status(400).end();

		const target = storage.dataPath(handle, _url);
		
		if (req.method === 'PUT' && fs.existsSync(target) && fs.statSync(target).isDirectory())
			return res.status(409).end();

		const ancestors = _url.split('/').slice(0, -1).reduce((coll, item) => {
			return coll.concat(`${ coll.at(-1) || '' }/${ item }`);
		}, []).map(e => storage.dataPath(handle, e));
		
		if (req.method === 'PUT' && !fs.existsSync(target))
			if (ancestors.filter(e => fs.existsSync(e) && fs.statSync(e).isFile()).length)
				return res.status(409).end();

		const meta = await storage.meta(handle, _url);

		if (['PUT', 'DELETE'].includes(req.method) && (
			!fs.existsSync(target) && req.headers['if-match']
			|| fs.existsSync(target) && req.headers['if-match'] && req.headers['if-match'] !== meta.ETag
			|| fs.existsSync(target) && req.headers['if-none-match']
			))
			return res.status(412).end();

		if (['HEAD', 'GET', 'DELETE'].includes(req.method) && !fs.existsSync(target))
			return res.status(404).send('Not found');

		if (req.method === 'GET' && fs.existsSync(target) && req.headers['if-none-match'])
			if (req.headers['if-none-match'].split(',').map(e => e.trim()).includes(meta.ETag))
				return res.status(304).end();

		if (req.method === 'PUT')
			await storage.put(handle, _url, req.body, ancestors, Object.assign(meta, {
				'Content-Type': req.headers['content-type'],
				'Last-Modified': new Date().toUTCString(),
			}));

		if (req.method === 'DELETE')
			await storage.delete(target, ancestors);

		if (isFolderRequest)
			meta['Content-Type'] = 'application/ld+json';
		
		res.set(meta).status(200);

		if (['HEAD', 'DELETE'].includes(req.method))
			return res.end();

		return isFolderRequest ? res.json({
			'@context': 'http://remotestorage.io/spec/folder-description',
			items: await storage.folderItems(handle, _url),
		}) : res.send(fs.readFileSync(target, meta['Content-Type'] === 'application/json' ? 'utf8' : undefined));
	},

};

export default mod;
