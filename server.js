var path = require('path');
var express = require('express');
var request = require('request');
var favicon = require('serve-favicon')
var cheerio = require('cheerio');
var jsdap = require('jsdap');

var app = express();
app.set('view engine', 'ejs');

var config = require('./server.config.json');

serverIndex = 0;
baseUrl = config.servers[serverIndex].base;
defaultRoute = config.servers[serverIndex].defaultroute;
baseFtps = config.servers[serverIndex].dataMirrors;

// Favicon Middleware
app.use(favicon(path.join(__dirname, 'public', 'favicon.png')));

// Logging Middleware
app.use(function(req, res, next) {
	console.log(new Date(), req.ip, req.originalUrl);
	next();
})

app.get('/', function (req, res) {
	//TODO show server selection page
	res.redirect(defaultRoute);
})

app.get('*.xml', function (req, res) {
	var path = baseUrl + req.originalUrl;
		request(path, function (error, response, body) {
			try {
				if (error) {
					res.status(response ? response.statusCode : 404).end(error);
				}
				if (!response || response.statusCode != 200) {
					res.status(response ? response.statusCode : 404).end(response);
				}

				var xml = cheerio.load(body);

				var title = xml('catalog').attr('name');

				var links = [];
				var catalogRefs = xml('catalogRef');
				for (var i=0; i<catalogRefs.length; i++) {
					var catalogRef = catalogRefs[i];
					links.push({
						href: catalogRef.attribs['xlink:href'],
						title: catalogRef.attribs['xlink:title']
					});
				}

				var datasets = [];
				xml('catalog dataset').each(function() {
					var baseOdap = xml('catalog service[name="odap"]').attr('base')
						|| xml('catalog service[serviceType="OPENDAP"]').attr('base') || '/';
					var baseHttp = baseUrl + (xml('catalog service[name="http"]').attr('base')
						|| xml('catalog service[serviceType="HTTPServer"]').attr('base') || '/');

					var dataPath = xml(this).attr('urlpath');
					if (dataPath) {
						var name = xml(this).attr('name');
						var id = xml(this).attr('id');

						var dataSize = xml('datasize', this);
						var size = dataSize.text() + ' ' + dataSize.attr('units');

						var modified = xml('date', this).text();

						var pathMeta = dataPath.startsWith('/') ? dataPath : baseOdap + dataPath;
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

				res.render('catalog', {
					title: title,
					links: links,
					datasets: datasets,
					xml: body
				});
		} catch (err) {
			res.status(404);
			res.render('error', {
				path: path,
				error: err
			});
		}
	});
})

app.get('*.nc?', function (req, res) {
	var path = baseUrl + req.originalUrl;
	try {
		jsdap.loadDataset(path, function(dataset) {
			res.setHeader('Content-Type', 'application/json');
			var json = JSON.stringify(dataset);
			// remove additional quotes
			json = json.replace(/\\"/g, '');
			res.send(json);
		});
	} catch (e) {
		res.send("Could not open dataset: " + path, e);
	}
})

app.use(function(req, res, next) {
	request(baseUrl + req.originalUrl, function (error, response, body) {
		res.setHeader('Content-Type', 'text/plain');
		res.send(body);
		next();
	});
})

app.listen(config.server.port, function () {
	console.log('listening on port ' + config.server.port);
})
