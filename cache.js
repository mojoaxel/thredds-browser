var express = require('express')
var APICacheProxy = require('node-api-cache-proxy')
var config = require('./server.config.json');

var app = express();

/*
config.servers.forEach(function(server) {
	var apiCacheProxy = new APICacheProxy({
		apiUrl: server.base,
		cacheDir: config.cache.dir + server.id + '/',
		localURLReplace: function(url) {
			return url.replace('/'+server.id+'/', '/');
		}
	})
	app.use('/'+server.id, apiCacheProxy);
});
*/

var server = config.servers[0];

var apiCacheProxy = new APICacheProxy({
	apiUrl: "https://www.esrl.noaa.gov",
	cacheDir: './cache/esrl.noaa/',
	localURLReplace: function(url) {
		return url.replace('/esrl.noa/', '/');
	}
})
app.use('/esrl.noa/', apiCacheProxy);

app.listen(config.cache.port, function () {
	console.log('listening on port ' + config.cache.port);
})
