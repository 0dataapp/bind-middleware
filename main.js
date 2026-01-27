const mod = {

	handle (req, res, next) {
		const root = req.protocol + '://' + req.get('host');

		if (req.url.toLowerCase().match('/.well-known/webfinger'))
			return res.json({
				links: [{
					rel: 'remotestorage',
					href: root + '/storage',
				}],
			});

		return res.status(401).send('Unauthorized');

		return next();
	},

};

export default mod;
