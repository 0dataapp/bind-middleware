import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const folder = path.join(__dirname, '__storage');

const metaSuffix = '.meta.json';

const mod = {

	util: {

		isJunk: e => [
			'.DS_Store',
		].includes(path.basename(e)),
		encoding: contentType => [
			'application/json',
			'text',
		].filter(e => contentType.startsWith(e)).length ? 'utf8' : undefined,
		isIgnored: e => mod.util.isJunk(e) || e.endsWith(metaSuffix),
		localPath: ({ handle, target }) => path.join(folder, handle, target),

	},

	_metaPath: target => `${ target }${ metaSuffix }`,
	_etag: () => (new Date()).toJSON(),
	
	put ({ handle, target: _path, data, breadcrumbs, meta }) {
		const target = mod.util.localPath({
			handle,
			target: _path,
		});

		fs.mkdirSync(path.dirname(target), { recursive: true });
		breadcrumbs.forEach(e => {
			e = mod.util.localPath({
				handle,
				target: e,
			}) + '/';

			const stat = fs.statSync(e);
			fs.writeFileSync(this._metaPath(e), JSON.stringify({
				ETag: stat.mtime.toJSON(),
			}));
		});
		
		fs.writeFileSync(target, meta['Content-Type'].startsWith('application/json') ? JSON.stringify(data) : Buffer.from(data));

		const stat = fs.statSync(target);
		fs.writeFileSync(this._metaPath(target), JSON.stringify(Object.assign(meta, {
			ETag: stat.mtime.toJSON(),
			'Content-Length': Buffer.isBuffer(data) ? data.length : stat.size,
			'Last-Modified': stat.mtime.toUTCString(),
		})));
	},

	delete ({ handle, target: _path, breadcrumbs }) {
		const target = mod.util.localPath({
			handle,
			target: _path,
		});
		fs.unlinkSync(target);
		fs.unlinkSync(this._metaPath(target));

		breadcrumbs.slice().sort().reverse().forEach(e => {
			e = mod.util.localPath({
				handle,
				target: e,
			});

			if (fs.readdirSync(e).filter(e => !mod.util.isIgnored(e)).length)
				return;

			fs.rmSync(e, { recursive: true, force: true })
		});

		breadcrumbs.map(e => mod.util.localPath({
			handle,
			target: e,
		})).filter(e => fs.existsSync(e) && fs.readdirSync(e).filter(e => !mod.util.isIgnored(e)).length).forEach(e => fs.writeFileSync(this._metaPath(`${ e }/`), JSON.stringify({
			ETag: this._etag(),
		})));
	},

	list ({ handle, target: _path }) {
		const target = mod.util.localPath({
			handle,
			target: _path,
		});

		return fs.readdirSync(target).filter(e => !mod.util.isIgnored(e)).reduce((coll, item) => {
			let e = path.join(target, item);

			if (fs.statSync(e).isDirectory()) {
				item += '/';
				e += '/';
			}

			return Object.assign(coll, {
				[item]: JSON.parse(fs.readFileSync(this._metaPath(e), 'utf8')),
			});
		}, {});
	},

	exists (params) {
		return fs.existsSync(mod.util.localPath(params));
	},

	isFolder (params) {
		return fs.statSync(mod.util.localPath(params)).isDirectory();
	},

	get (params) {
		return fs.readFileSync(mod.util.localPath(params), mod.util.encoding(params.contentType));
	},

	meta (params) {
		const target = mod.util.localPath(params);

		if (!fs.existsSync(target) || !fs.existsSync(this._metaPath(target)))
			return {
				ETag: 'empty',
			};

		return JSON.parse(fs.readFileSync(this._metaPath(target), 'utf8'));
	},
	
};

export default mod;
