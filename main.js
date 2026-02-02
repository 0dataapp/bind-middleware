import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prefix = 'storage';

const metaSuffix = '.meta.json';

const mod = {

	metaPath: target => `${ target }${ metaSuffix }`,
	isMetaPath: e => e.endsWith(metaSuffix),
	
	isIgnorePath: e => [
		'.DS_Store',
	].includes(path.basename(e)),

	_parseToken: e => (!e || !e.trim()) ? null : e.split('Bearer ').pop(),

	_resolvePath: (handle, url) => path.join(__dirname, '__storage', handle, url),
	
	handler: adapter => async (req, res, next) => {
		if (req.url.toLowerCase().match('/.well-known/webfinger'))
			return res.json({
				links: [{
					rel: 'remotestorage',
					href: `${ req.protocol }://${ req.get('host') }/me/${ prefix }`,
					type: 'draft-dejong-remotestorage-02',
				}],
			});

		const [handle, _url] = req.url.match(new RegExp(`^\\/(\\w+)\\/${ prefix }(.*)`)).slice(1);
		const token = mod._parseToken(req.headers.authorization);

		if (!token)
			return res.status(401).end();

		const permissions = await adapter.permissions(handle, token);

		if (!permissions)
			return res.status(401).end();

		const scope = _url.match(/^\/[^\/]+\//).shift()
		// if (!Object.keys(permissions).includes(`/${ scope }/`))
		// 	return res.status(401).end();

		if (['PUT', 'DELETE'].includes(req.method) && !permissions[scope].includes('w'))
			return res.status(401).end();

		res.set({
			'Access-Control-Allow-Origin': req.headers['origin'] || '*',
			'Access-Control-Expose-Headers': 'Content-Length, Content-Type, ETag',	
		});

		if (req.method === 'OPTIONS')
			return res.set({
				'Access-Control-Allow-Methods': 'OPTIONS, GET, HEAD, PUT, DELETE',
				'Access-Control-Allow-Headers': 'Authorization, Content-Length, Content-Type, If-Match, If-None-Match, Origin, X-Requested-With',				
			}).status(204).end();

		if (req.method === 'PUT' && req.headers['content-range'])
				return res.status(400).end();

		const _folders = _url.split('/').slice(0, -1).reduce((coll, item) => {
			return coll.concat(`${ coll.at(-1) || '' }/${ item }`);
		}, []).map(e => adapter.dataPath(handle, e));
		const target = adapter.dataPath(handle, _url);

		if (req.method === 'PUT' && fs.existsSync(target) && fs.statSync(target).isDirectory())
			return res.status(409).end();

		if (req.method === 'PUT' && !fs.existsSync(target))
			if (_folders.filter(e => fs.existsSync(e) && fs.statSync(e).isFile()).length)
				return res.status(409).end();

		const meta = await adapter.meta(target);

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

		if (req.method === 'PUT') {
			const folder = `${ path.dirname(target) }${ path.sep }`;
			fs.mkdirSync(folder, { recursive: true });
			await adapter.putParents(_folders);

			fs.writeFileSync(target, req.headers['content-type'] === 'application/json' ? JSON.stringify(req.body) : req.body);
			await adapter.putChild(target, Object.assign(meta, {
				'Content-Type': req.headers['content-type'],
				'Content-Length': Buffer.isBuffer(req.body) ? req.body.length : fs.statSync(target).size,
			}));
		}

		res.set(meta).status(200);

		const isFolder = req.url.endsWith('/');

		if (isFolder)
			res.set({
				'Content-Type': 'application/ld+json',
			});
		
		if (req.method === 'HEAD')
			return res.end();

		if (req.method === 'DELETE') {
			fs.unlinkSync(mod.metaPath(target));
			fs.unlinkSync(target);

			_folders.filter(e => !fs.readdirSync(e).filter(e => !mod.isMetaPath(e)).length).forEach(e => {
				fs.unlinkSync(mod.metaPath(`${e}/`));
				fs.rmdirSync(e);
			});

			// Object.keys(meta).forEach(e => delete meta[e]);

			_folders.filter(e => fs.existsSync(e) && fs.readdirSync(e).filter(e => !mod.isMetaPath(e)).length).forEach(e => fs.writeFileSync(mod.metaPath(`${ e }/`), JSON.stringify({
				ETag: new Date().toJSON(),
			})));

			return res.end();
		}

		if (!isFolder)
			return res.send(meta['Content-Type'] === 'application/json' ? fs.readFileSync(target, 'utf8') : fs.readFileSync(target));

		return res.json({
			'@context': 'http://remotestorage.io/spec/folder-description',
			items: fs.readdirSync(target).filter(e => !mod.isMetaPath(e) && !mod.isIgnorePath(e)).reduce((coll, item) => {
				let _path = path.join(target, item);

				if (fs.statSync(_path).isDirectory()) {
					item = `${ item }/`;
					_path = `${ _path }/`;
				}

				return Object.assign(coll, {
					[item]: JSON.parse(fs.readFileSync(mod.metaPath(_path), 'utf8')),
				});
			}, {}),
		});
	},

};

export default mod;
