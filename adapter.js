import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const metaSuffix = '.meta.json';

const mod = {

	_resolvePath: (handle, url) => path.join(__dirname, '__storage', handle, url),

	_readJson (path) {
    try {
      const content = fs.readFileSync(path);
      return content ? JSON.parse(content) : null;
    } catch (e) {
      if (e.code !== 'ENOENT')
      	console.error('reading JSON failed:', e);

      return null;
    }
  },

  permissions (handle, token) {
	  const user = mod._readJson(mod._resolvePath(handle, 'auth.json'));
	  if (!user)
	  	return {};

	  const data = user.sessions;
	  if (!data || !data[token])
	  	return {};

	  const permissions = data[token].permissions;
	  if (!permissions)
	  	return {};
	  
	  const output = {};

	  for (const category in permissions) {
	    output[category] = Object.keys(permissions[category]).sort();
	  }

	  return output;
	},

	dataPath: (handle, url) => mod._resolvePath(handle, path.join('data', url)),

	metaPath: target => `${ target }${ metaSuffix }`,
	isIgnored: e => e.endsWith(metaSuffix) || [
		'.DS_Store',
	].includes(path.basename(e)),

	meta: (handle, _url) => {
		const target = mod.dataPath(handle, _url);
		return fs.existsSync(target) ? JSON.parse(fs.readFileSync(mod.metaPath(target), 'utf8')) : {}
	},

	etag: () => new Date().toJSON(),

	put (handle, _url, data, _folders, meta) {
		const target = mod.dataPath(handle, _url);

		fs.mkdirSync(path.dirname(target), { recursive: true });
		_folders.forEach(e => fs.writeFileSync(mod.metaPath(`${ e }/`), JSON.stringify({
			ETag: mod.etag(),
		})));
		
		fs.writeFileSync(target, meta['Content-Type'] === 'application/json' ? JSON.stringify(data) : data);
		fs.writeFileSync(mod.metaPath(target), JSON.stringify(Object.assign(meta, {
			ETag: mod.etag(),
			'Content-Length': Buffer.isBuffer(data) ? data.length : fs.statSync(target).size,
		})));
	},

	delete (target, _folders) {
		fs.unlinkSync(mod.metaPath(target))

		_folders.filter(e => !fs.readdirSync(e).filter(e => !mod.isIgnored(e)).length).forEach(e => {
			fs.unlinkSync(mod.metaPath(`${e}/`));
			fs.rmdirSync(e);
		});

		_folders.filter(e => fs.existsSync(e) && fs.readdirSync(e).filter(e => !mod.isIgnored(e)).length).forEach(e => fs.writeFileSync(mod.metaPath(`${ e }/`), JSON.stringify({
			ETag: mod.etag(),
		})));
	},

	folderItems: target => fs.readdirSync(target).filter(e => !mod.isIgnored(e)).reduce((coll, item) => {
		let _path = path.join(target, item);

		if (fs.statSync(_path).isDirectory()) {
			item = `${ item }/`;
			_path = `${ _path }/`;
		}

		return Object.assign(coll, {
			[item]: JSON.parse(fs.readFileSync(mod.metaPath(_path), 'utf8')),
		});
	}, {}),

};

export default mod;
