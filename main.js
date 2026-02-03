import fs from 'fs';

const prefix = 'storage';

const mod = {

	_parseToken: e => (!e || !e.trim()) ? null : e.split('Bearer ').pop(),

	handler: adapter => async (req, res, next) => {
		// console.info(req.method, req.url);
		if (req.url.toLowerCase().match('/.well-known/webfinger'))
			return res.json({
				links: [{
					rel: 'remotestorage',
					href: `${ req.protocol }://${ req.get('host') }/${ prefix }/me`,
					type: 'draft-dejong-remotestorage-07',
				}],
			});

		const [handle, publicFolder, _url] = req.url.match(new RegExp(`^\\/${ prefix }\\/(\\w+)(\\/public)?(.*)`)).slice(1);
		const token = mod._parseToken(req.headers.authorization);

		if (!publicFolder && !token)
			return res.status(401).end();

		const isFolderRequest = req.url.endsWith('/');

		const permission = await adapter.permission(handle, token);

		if (publicFolder && isFolderRequest && !permission)
			return res.status(401).end();

		if (!publicFolder && !permission)
			return res.status(401).end();

		const scope = _url === '/' ? '/*/' : `/${ _url.match(/^\/([^\/]+)/).pop() }/`;

		if (!publicFolder && permission && !Object.keys(permission).includes(scope))
			return res.status(401).end();

		if (['PUT', 'DELETE'].includes(req.method) && (!permission || !permission[scope].includes('w')))
			return res.status(401).end();

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

		if (req.method === 'PUT' && req.headers['content-range'])
				return res.status(400).end();

		const target = adapter.dataPath(handle, _url);
		
		if (req.method === 'PUT' && fs.existsSync(target) && fs.statSync(target).isDirectory())
			return res.status(409).end();

		const ancestors = _url.split('/').slice(0, -1).reduce((coll, item) => {
			return coll.concat(`${ coll.at(-1) || '' }/${ item }`);
		}, []).map(e => adapter.dataPath(handle, e));
		
		if (req.method === 'PUT' && !fs.existsSync(target))
			if (ancestors.filter(e => fs.existsSync(e) && fs.statSync(e).isFile()).length)
				return res.status(409).end();

		const meta = await adapter.meta(handle, _url);

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
			await adapter.put(handle, _url, req.body, ancestors, Object.assign(meta, {
				'Content-Type': req.headers['content-type'],
			}));

		if (req.method === 'DELETE')
			await adapter.delete(target, ancestors);

		if (isFolderRequest)
			meta['Content-Type'] = 'application/ld+json';
		
		res.set(meta).status(200);

		if (['HEAD', 'DELETE'].includes(req.method))
			return res.end();

		return isFolderRequest ? res.json({
			'@context': 'http://remotestorage.io/spec/folder-description',
			items: await adapter.folderItems(handle, _url),
		}) : res.send(fs.readFileSync(target, meta['Content-Type'] === 'application/json' ? 'utf8' : undefined));
	},

};

export default mod;
