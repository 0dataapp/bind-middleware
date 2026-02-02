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
	
	meta: target => fs.existsSync(target) ? JSON.parse(fs.readFileSync(mod.metaPath(target), 'utf8')) : {},

	etag: () => new Date().toJSON(),

	putParents: _folders => _folders.forEach(e => fs.writeFileSync(mod.metaPath(`${ e }/`), JSON.stringify({
		ETag: mod.etag(),
	}))),

	putChild: (target, meta) => fs.writeFileSync(mod.metaPath(target), JSON.stringify(Object.assign(meta, {
		ETag: mod.etag(),
	}))),

};

export default mod;
