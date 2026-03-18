import express from 'express';
import dotenv from 'dotenv';
dotenv.config({ path: './.env-sample' });

const tokens = process.env.TOKENS.split(',').map(e => {
	const parts = e.split(/\s+/);
	return {
		token: parts[0],
		scope: parts.slice(1),
	};
});

import fs from 'fs';

import glue from './main.js';

import hold from './adapter.js';

const storagePath = '/storage';
const authPath = '/authorize';
const port = process.env.PORT || 3000;
express()
	.use(glue.cors())
	.use(glue.webfinger({
		storagePath: handle => `${ storagePath }/${ handle }`,
		authPath,
	}))
	.enable('trust proxy')
	.get(authPath, (req, res, next) => {
		return res.send(fs.readFileSync('./authorize.html', 'utf8').replace('$REDIRECT_URI', req.query.redirect_uri).replace('$ADDRESS', `${ process.env.USERNAME }@${ req.host }`).replace('$TOKENS', JSON.stringify(tokens, null, ' ')));
	})
	.use(storagePath, express.json(), express.raw({
		limit: '1mb',
		type: '*/*',
	}), glue.remotestorage({
		getScope (username, token) {
			if (username !== process.env.USERNAME)
				return
			
			return tokens.filter(e => e.token === token).shift()?.scope.join(' ');
		},
		hold,
	}))
	.listen(port, () => console.info('> Running on port ' + port));
