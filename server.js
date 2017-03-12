var _ = require('underscore');
var path = require('path');
var fs = require('fs');
var mkdirp = require('mkdirp');
var express = require('express');
var request = require('request');
var favicon = require('serve-favicon')
var cheerio = require('cheerio');
var jsdap = require('jsdap');

var app = express();
app.set('view engine', 'ejs');

var config = require('./server.config.json');
var prefix, baseUrl, defaultRoute, baseFtps;

// Favicon Middleware
app.use(favicon(path.join(__dirname, 'public', 'favicon.png')));

// Logging Middleware
app.use(function(req, res, next) {
	console.log(new Date(), req.ip, req.originalUrl);
	next();
})

app.get('/', function (req, res) {
	res.render('index', {
		servers: config.servers
	});
});

// Servers Middleware
app.use(function(req, res, next) {
	prefix = null;
	config.servers.forEach(function(server) {
		if (req.originalUrl.indexOf(server.id) >= 0) {
			prefix = '/'+server.id;
			baseUrl = server.base;
			defaultRoute = server.defaultroute;
			baseFtps = server.dataMirrors;
		}
	});
	if (!prefix) {
		console.warn("unknown prefix");
		res.redirect('/');
	}
	next();
});

app.get('*.xml', function (req, res) {
	var url = baseUrl + req.originalUrl.replace( prefix+'/', '/');

	var cachePath = path.join(__dirname, './cache', req.originalUrl);
	//console.log("CACHEPATH: ", cachePath);

	function parseCatalog(body) {
		var xml = cheerio.load(body);

		var title = xml('catalog').attr('name') || xml('thredds:catalog').attr('name');

		var links = [];
		var catalogRefs = xml('catalogRef');
		for (var i=0; i<catalogRefs.length; i++) {
			var catalogRef = catalogRefs[i];
			var href = catalogRef.attribs['xlink:href'];
			if (href && prefix && href.startsWith('/')) {
				href = prefix + href;
			}
			links.push({
				href: href,
				title: catalogRef.attribs['xlink:title']
			});
		}

		var datasets = [];
		xml('catalog dataset').each(function() {
			var baseOdap = xml('catalog service[name="odap"]').attr('base')
				|| xml('catalog service[serviceType="OPENDAP"]').attr('base') || '/';
			var baseHttp = baseUrl + (xml('catalog service[name="http"]').attr('base')
				|| xml('catalog service[serviceType="HTTPServer"]').attr('base') || '/');

			baseOdap = prefix + baseOdap;

			var dataPath = xml(this).attr('urlpath');
			if (dataPath) {
				var name = xml(this).attr('name');
				var id = xml(this).attr('id');

				var dataSize = xml('datasize', this);
				var size = dataSize.text() + ' ' + dataSize.attr('units');

				var modified = xml('date', this).text();

				var pathMeta = dataPath.startsWith('/') ? prefix + dataPath : baseOdap + dataPath;
				var pathData = dataPath.startsWith('/') ? dataPath : baseHttp + dataPath;

				var ftpPath = (dataPath.startsWith('/') ? dataPath : '/' + dataPath);
				var pathFtp = baseFtps.map(function(ftp) {
					return ftp + ftpPath;
				});

				datasets.push({
					name: name,
					size: size,
					modified: modified,
					id: id,
					pathMeta: pathMeta,
					pathData: pathData,
					pathFtp: pathFtp
				});

			} else {
				title = xml(this).attr('id');
			}
		});

		return {
			title: title,
			links: links,
			datasets: datasets,
			xml: body
		}
	}

	if (fs.existsSync(cachePath)) {
		fs.readFile(cachePath, 'utf8', function (err, body) {
			if (err) throw err;
			//console.log("CACHE read "+cachePath);
			var data = parseCatalog(body);
			res.render('catalog', data);
		});
	} else {
		request(url, function (error, response, body) {
			try {
				if (error) {
					res.status(response ? response.statusCode : 404).end(error);
				}
				if (!response || response.statusCode != 200) {
					res.status(response ? response.statusCode : 404).end(response);
				}

				var data = parseCatalog(body);
				res.render('catalog', data);

				mkdirp(path.dirname(cachePath), function(err) {
					if (err) {
						console.error("ERROR creating cache directory "+ path.dirname(cachePath));
					} else {
						fs.writeFile(cachePath, body, 'utf8', function(err) {
							if (err) {
								return console.error("Error saving cache file "+cachePath+": ", err);
							}
							//console.log("CACHE: saved file "+cachePath);
						});
					}
				});

			} catch (err) {
				res.status(404);
				res.render('error', {
					url: url,
					error: err
				});
			}
		});
	}
})

app.get('*.nc?|*.hdf', function (req, res) {
	var url = baseUrl + req.originalUrl.replace( prefix+'/', '/');
	var cachePath = path.join(__dirname, './cache', req.originalUrl);
	cachePath = cachePath + '.json'
	//console.log("CACHEPATH: ", cachePath);

	if (fs.existsSync(cachePath)) {
		fs.readFile(cachePath, 'utf8', function (err, json) {
			if (err) throw err;
			//console.log("CACHE read "+cachePath);
			res.send(json);
		});
	} else {
		try {
			jsdap.loadDataset(url, function(dataset) {
				res.setHeader('Content-Type', 'application/json');
				var json = JSON.stringify(dataset);
				// remove additional quotes
				json = json.replace(/\\"/g, '');

				mkdirp(path.dirname(cachePath), function(err) {
					if (err) {
						console.error("ERROR creating cache directory "+ path.dirname(cachePath));
					} else {
						fs.writeFile(cachePath, json, 'utf8', function(err) {
							if (err) {
								return console.error("Error saving cache file "+cachePath+": ", err);
							}
							//console.log("CACHE: saved file "+cachePath);
						});
					}
				});

				res.send(json);
			});
		} catch (e) {
			res.send("Could not open dataset: " + url, e);
		}
	}
})

app.use(function(req, res, next) {
	request(url, function (error, response, body) {
		res.setHeader('Content-Type', 'text/plain');
		res.send(body);
		next();
	});
})

app.listen(config.server.port, function () {
	console.log('APP listening on port ' + config.server.port);
})
