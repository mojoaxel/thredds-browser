var express = require('express');
var request = require('request');
var cheerio = require('cheerio');
var jsdap = require('jsdap');

var app = express();
app.set('view engine', 'ejs');


var port = 3000;
var baseUrl = 'https://www.esrl.noaa.gov';
var baseFtps = ['ftp://ftp.cdc.noaa.gov', 'ftp://140.172.38.84', 'ftp://140.172.38.83']

app.get('/', function (req, res) {
	res.redirect('/psd/thredds/catalog.xml');
})

app.get('*.xml', function (req, res) {
	console.log(new Date(), req.ip, req.originalUrl);

	request(baseUrl + req.originalUrl, function (error, response, body) {
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
			var baseOdap = xml('catalog service[name="odap"]').attr('base');
			var baseHttp = baseUrl + xml('catalog service[name="http"]').attr('base');

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
	});

})

app.get('*.nc', function (req, res) {
	jsdap.loadDataset(baseUrl + req.originalUrl, function(dataset) {
		res.setHeader('Content-Type', 'application/json');
		var json = JSON.stringify(dataset);
		// remove additional quotes
		json = json.replace(/\\"/g, '');
		res.send(json);
	});
})

app.listen(port, function () {
	console.log('listening on port ' + port);
})
