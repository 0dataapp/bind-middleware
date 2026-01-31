import fs from 'fs';
import path from 'path';
import mime from 'mime';
import { utimesSync } from 'utimes';

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mod = {

	etag: target => fs.statSync(target).mtime.toJSON().replace(/\D/g, ''),

	handle (req, res, next) {
		const prefix = '/storage';
		const isFolder = req.url.endsWith('/');
		const target = path.join(__dirname, '__storage', req.url.split(prefix).slice(1).join(prefix));

		if (req.url.toLowerCase().match('/.well-known/webfinger'))
			return res.json({
				links: [{
					rel: 'remotestorage',
					href: req.protocol + '://' + req.get('host') + prefix,
					type: 'draft-dejong-remotestorage-02',
				}],
			});

		if (!req.headers.authorization)
			return res.status(401).send('Unauthorized');

		res.set({
			'Access-Control-Allow-Origin': req.headers['origin'] || '*',
			'Access-Control-Expose-Headers': 'Content-Length, Content-Type, ETag',	
		})

		if (req.method === 'OPTIONS')
			return res.set({
				'Access-Control-Allow-Methods': 'OPTIONS, GET, HEAD, PUT, DELETE',
				'Access-Control-Allow-Headers': 'Authorization, Content-Length, Content-Type, If-Match, If-None-Match, Origin, X-Requested-With',				
			}).status(204).end();

		if (req.method === 'PUT' && fs.existsSync(target) && !isFolder && fs.statSync(target).isDirectory())
			return res.status(409).send('Conflict');

		if (['PUT', 'DELETE'].includes(req.method) && (
			!fs.existsSync(target) && req.headers['if-match']
			|| fs.existsSync(target) && req.headers['if-match'] && req.headers['if-match'] !== mod.etag(target)
			|| fs.existsSync(target) && req.headers['if-none-match']
			))
			return res.status(412).send('Precondition failed');

		if (['HEAD', 'GET', 'DELETE'].includes(req.method) && !fs.existsSync(target))
			return res.status(404).send('Not found');

		if (req.method === 'GET' && fs.existsSync(target) && req.headers['if-none-match'])
			if (req.headers['if-none-match'].split(',').map(e => e.trim()).includes(mod.etag(target)))
				return res.status(304).send('Not Modified');

		if (req.method === 'PUT') {
			const folder = path.dirname(target);
			fs.mkdirSync(folder, { recursive: true });
			utimesSync(folder, { mtime: Date.now() });
			fs.writeFileSync(target, JSON.stringify(req.body));
		}

		const etag = mod.etag(target);
		
		if (req.method === 'DELETE') {
			fs.unlinkSync(target);
			return res.set({
				ETag: etag,
			}).status(200).send('OK');
		}

		res.set({
			'Content-Type': isFolder ? 'application/ld+json' : 'application/json',
			ETag: etag,
		}).status(200);

		if (req.method === 'HEAD')
			return res.set({
				'Content-Length': fs.statSync(target).size,
			}).end();

		if (!isFolder)
			return res.json(JSON.parse(fs.readFileSync(target, 'utf8')));

		return res.json({
			'@context': 'http://remotestorage.io/spec/folder-description',
			items: fs.readdirSync(target).reduce((coll, item) => {
				const _path = path.join(target, item);
				const stats = fs.statSync(_path);
				return Object.assign(coll, {
					[stats.isFile() ? item : `${ item }/`]: {
						ETag: stats.mtime.toJSON().replace(/\D/g, ''),
						'Content-Length': stats.size,
						'Content-Type': mime.getType(_path) || 'application/json',
					},
				});
			}, {}),
		});
	},

};

export default mod;
