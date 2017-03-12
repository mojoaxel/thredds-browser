var _ = require('underscore');
var path = require('path');
var fs = require('fs');
var mkdirp = require('mkdirp');
var express = require('express');
var request = require('request');
var favicon = require('serve-favicon')
var cheerio = require('cheerio');
var parseString = require('xml2js').parseString;
var jsdap = require('jsdap');

var app = express();
app.set('view engine', 'ejs');

var config = require('./server.config.json');
var prefix, baseUrl, defaultRoute, baseFtps;

config.servers = _.filter(config.servers, function(server) {
	return !server.disabled;
})

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

	function parseCatalog(xml, callback) {
		xml = xml.replace(/<thredds:/g, '<').replace(/<\/thredds:/g, '</');
		parseString(xml, function (err, catalog) {
			if (catalog && catalog.catalog) {
				catalog = catalog.catalog;
			}
			if (!catalog) {
				console.error("no catalog found!");
				return;
			}
			//console.log(JSON.stringify(catalog, null, 2));

			var title = catalog.$.name;

			var services = {};
			function parseServices(dataset) {
				if (dataset.service) {
					for (var i=0; i<dataset.service.length; i++) {
						var service = dataset.service[i];
						services[service.$["name"]] = {
							type: service.$["serviceType"],
							base: service.$["base"]
						}
						if (service.service) {
							parseServices(service);
						}
					}
				}
				return services;
			}

			var services = parseServices(catalog);
			//console.log(JSON.stringify(services, null, 2));

			var baseOdap = services['odap'] ? services['odap'].base : services['dap'] ? services['dap'].base : '/';
			var baseHttp = services['http'] ? services['http'].base : services['file'] ? services['file'].base : '/';

			//console.log("baseOdap: ", baseOdap);
			//console.log("baseHttp: ", baseHttp);

			function parseLinks(dataset) {
				var links = [];
				var catalogRefs = dataset.catalogRef;
				if (catalogRefs) {
					for (var i=0; i<catalogRefs.length; i++) {
						var catalogRef = catalogRefs[i];
						var href = catalogRef.$['xlink:href'];
						if (href && prefix && href.startsWith('/')) {
							href = prefix + href;
						}
						links.push({
							href: href,
							title: catalogRef.$['xlink:title']
						});
					}
				}
				return links;
			}

			var links = parseLinks(catalog);

			function parseDataset(datasets) {
				var sets = [];
				if (!datasets) return {};
				for (var i=0; i<datasets.length; i++) {
					dataset = datasets[i];
					var set = {
						name: dataset.$['name'],
						id: dataset.$['ID']
					};

					var urlPath = dataset.$['urlPath'];
					if (urlPath) {
						set.href = urlPath;

						set.path_meta = urlPath.startsWith('/') ? prefix + urlPath : prefix + baseOdap + urlPath;
						set.path_data = urlPath.startsWith('/') ? urlPath : prefix + baseHttp + urlPath;

						ftpPath = (urlPath.startsWith('/') ? urlPath : '/' + urlPath);
						set.path_ftp = baseFtps.map(function(ftp) {
							return ftp + ftpPath;
						});
					} else {
						var access = dataset.access;
						if (access && access[0] && access[0]['$'] && access[0]['$']["urlPath"]) {
							urlPath = access[0]['$']["urlPath"];
						}

						if (urlPath) {
							set.path_meta = prefix + baseOdap + urlPath;
							set.path_data = prefix + baseHttp + urlPath;
						}
					}
					var dataSize = dataset["dataSize"];
					if (dataSize && dataSize[0] && dataSize[0]['_'] && dataSize[0]['$'] && dataSize[0]['$'].units) {
						set.size = dataSize[0]['_'] + ' ' + dataSize[0]['$'].units;
					}

					var date = dataset["date"];
					if (date && date[0] && date[0]['_'] && date[0]['$'] && date[0]['$'].type) {
						set.date = date[0]['_'] + ' (' + date[0]['$'].type + ')';
					}

					var links = parseLinks(dataset);
					if (links) {
						set.links = links;
					}

					if (dataset.dataset) {
						set.children = parseDataset(dataset.dataset);
					}

					sets.push(set);
				}
				return sets;
			}

			var datasets = parseDataset(catalog.dataset);

			if (callback) {
				callback({
					title: title,
					links: links,
					datasets: datasets,
					xml: xml
				});
			}
		});
	}

	if (fs.existsSync(cachePath)) {
		fs.readFile(cachePath, 'utf8', function (err, body) {
			if (err) throw err;
			//console.log("CACHE read "+cachePath);
			parseCatalog(body, function(data) {
				//console.log(JSON.stringify(data, null, 2));
				res.render('catalog', data);
			});
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

				parseCatalog(body, function(data) {
					if (data) {
						res.render('catalog', data);
					} else {
						res.render('error', {
							url: url,
							error: "Could not parse XML Catalog"
						});
					}
				})

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

app.get('*.nc?|*.hdf|*.cdf', function (req, res) {
	var url = baseUrl + req.originalUrl.replace( prefix+'/', '/');
	var cachePath = path.join(__dirname, './cache', req.originalUrl);
	cachePath = cachePath + '.json'
	//console.log("CACHEPATH: ", cachePath);

	if (fs.existsSync(cachePath)) {
		fs.readFile(cachePath, 'utf8', function (err, json) {
			if (err) throw err;
			//console.log("CACHE read "+cachePath);
			res.setHeader('Content-Type', 'application/json');
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
	request(req.url, function (error, response, body) {
		res.setHeader('Content-Type', 'text/plain');
		res.send(body);
		next();
	});
})

app.listen(config.server.port, function () {
	console.log('APP listening on port ' + config.server.port);
})
