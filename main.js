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

  _tidyEtag: e => {
		const string = e.trim();
		const quote = '"';
		return string.startsWith(quote) && string.endsWith(quote) ? string.slice(1, -1) : string;
	},

	cors: () => (req, res, next) => {
		res.set({
			'Access-Control-Allow-Origin': req.headers['origin'] || '*',
			'Access-Control-Allow-Headers': 'Authorization, Content-Length, Content-Type, If-Match, If-None-Match, Origin, X-Requested-With, Content-Range',
			'Access-Control-Allow-Credentials': 'true',
			'Access-Control-Expose-Headers': 'Content-Length, Content-Type, ETag',
			'Cache-control': 'no-cache',
		});

		if (req.method === 'OPTIONS')
			return res.set({
				'Access-Control-Allow-Methods': 'OPTIONS, GET, HEAD, PUT, DELETE',
			}).status(204).end();

		return next();
	},

	webfinger: ({ prefix, swapHandle }) => async (req, res, next) => {
		if (!req.url.toLowerCase().match('/.well-known/webfinger'))
			return next();

		const base = `${ req.protocol }://${ req.get('host') }`;
		
		let handle = mod._parseHandle(req.query);

		if (!handle)
			return next();

		if (swapHandle)
			handle = await swapHandle(handle);

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

	storage: ({ storage, getScope }) => async (req, res, next) => {
		// console.info(req.method, req.url);
		const [handle, publicFolder, _url] = req.url.match(new RegExp(`^\\/(\\w+)(\\/public)?(.*)`)).slice(1);
		const token = mod._parseToken(req.headers.authorization);

		if (!publicFolder && !token)
			return res.status(401).send('missing token');

		const isFolderRequest = req.url.endsWith('/');

		const scope = await getScope(handle, token);

		if (!scope && publicFolder && isFolderRequest)
			return res.status(401).end();

		if (!scope && !publicFolder)
			return res.status(401).send('missing scope');

		const _scope = _url === '/' ? '/' : _url.match(/^\/([^\/]+)/).pop();

		const scopes = !scope ? {
			// if publicFolder, we may not have a token
		} : mod._parseScopes(scope);

		if (!publicFolder && scope && !Object.keys(scopes).includes(_scope) && !Object.keys(scopes).includes('*'))
			return res.status(401).send('invalid scope');

		if (['PUT', 'DELETE'].includes(req.method) && (!scope || !(scopes[_scope] || scopes['*']).includes('w')))
			return res.status(401).send('invalid access');

		if (req.method === 'PUT' && req.headers['content-range'])
				return res.status(400).end();

		const __url = `${ publicFolder ? '/public' : ''}${ _url }`;
		const target = storage.dataPath(handle, __url);
		
		if (req.method === 'PUT' && fs.existsSync(target) && fs.statSync(target).isDirectory())
			return res.status(409).end();

		const ancestors = __url.split('/').slice(0, -1).reduce((coll, item) => {
			return coll.concat(`${ coll.at(-1) || '' }/${ item }`);
		}, []).map(e => storage.dataPath(handle, e));
		
		if (req.method === 'PUT' && !fs.existsSync(target))
			if (ancestors.filter(e => fs.existsSync(e) && fs.statSync(e).isFile()).length)
				return res.status(409).end();

		const meta = await storage.meta(handle, __url);

		if (['PUT', 'DELETE'].includes(req.method) && (
			!fs.existsSync(target) && req.headers['if-match']
			|| fs.existsSync(target) && req.headers['if-match'] && mod._tidyEtag(req.headers['if-match']) !== meta.ETag
			|| fs.existsSync(target) && req.headers['if-none-match']
			))
			return res.status(412).end();

		if (['HEAD', 'GET', 'DELETE'].includes(req.method) && !fs.existsSync(target))
			return res.status(404).send('Not found');

		if (req.method === 'GET' && fs.existsSync(target) && req.headers['if-none-match'] && req.headers['if-none-match'].split(',').map(mod._tidyEtag).includes(meta.ETag))
			return res.status(304).end();

		if (req.method === 'PUT')
			await storage.put(handle, __url, req.body, ancestors, Object.assign(meta, {
				'Content-Type': req.headers['content-type'],
				'Last-Modified': new Date().toUTCString(),
			}));

		if (req.method === 'DELETE')
			await storage.delete(target, ancestors);

		if (isFolderRequest)
			meta['Content-Type'] = 'application/ld+json';
		
		meta['ETag'] = `"${ meta['ETag'] }"`;
		
		res
			.set(meta)
			.status(200);

		if (['HEAD', 'DELETE'].includes(req.method))
			return req.headers['user-agent'].match(/firefox/i) && req.method === 'DELETE' ? res.send('') : res.end(); // Firefox fails the request unless there's a body.

		return isFolderRequest ? res.json({
			'@context': 'http://remotestorage.io/spec/folder-description',
			items: await storage.folderItems(handle, __url),
		}) : res.send(fs.readFileSync(target, meta['Content-Type'].startsWith('application/json') ? 'utf8' : undefined));
	},

	sveltekit: (middleware, path) => async ({ event, resolve }) => {
	  if (path && !event.url.pathname.startsWith(path))
	    return resolve(event);

	  const [protocol, host] = [event.url.protocol.replace(/\:$/, ''), event.url.host];
	  const req = {
	    url: `${ event.url.pathname }${ event.url.search }`,
	    protocol,
	    query: event.url.search,
	    method: event.request.method,
	    headers: Object.fromEntries(event.request.headers),
	    get: key => ({
	    	host,
	    }[key]),
	  };

	  if (path)
	  	req.url = req.url.replace(new RegExp(`^${ path.replaceAll('/', '\\/') }`), '');

	  if (req.method === 'PUT' && !event.request.__body)
	    event.request.__body = await (function () {
	      if (event.request.headers.get('content-type').startsWith('application/json'))
	        return event.request.json();

	      if (event.request.headers.get('content-type').startsWith('text/'))
	        return event.request.text();
	      
	      return event.request.arrayBuffer();
	    })();

	  if (req.method === 'PUT')
	    req.body = event.request.__body;

	  event.__headers = event.__headers || {};

	  const res = {
	  	set: obj => (Object.keys(obj).forEach(key => event.__headers[key] = obj[key]), res),

	    status: code => (res._status = code, res),
	    json: obj => res.send(JSON.stringify(obj)),
	    send: body => (res.body = body, res.end()),
	    end: () => new Response(res.body, {
	      status: res._status || 200,
	      headers: event.__headers,
	    }),
	  };

	  return middleware(req, res, err => {
	  	if (err)
	  		throw err;

	  	return resolve(event);
	  });
	},

};

export default mod;
