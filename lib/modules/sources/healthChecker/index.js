var moment = require('moment');
var http = require('http');
var async = require('async');
var _ = require('lodash');
var request = require('request');
var url = require('url')

function checkServerHealth(server, healthChecker, callback) {
	var isTimeout;
	var options = {
		url: url.format({
			protocol: 'http',
			hostname: server.host,
			port: server.port || 80,
			pathname: healthChecker.path
		}),
		headers: _.merge(healthChecker.headers, server.headers),
		proxy: _.merge(healthChecker.proxy, server.proxy)
	};
	console.dir(options);
	var req = request.get(options, function(error, res, body) {

		if (error) {
			return callback(null, {
				server: server,
				status: {
					status: isTimeout ? healthChecker.timeout.status : 'ERROR'
				}
			});
		}

		var matchedStatus;
		var numberOfHealthCheckers = healthChecker.status.length;
		var x = 0;

		for(;x < numberOfHealthCheckers;x++) {
			var statusRegex = new RegExp(healthChecker.status[x].statusRegex);

			if(statusRegex.test(res.statusCode)) {
				matchedStatus = healthChecker.status[x];
				break;
			}
		}

		if (!matchedStatus) {
			matchedStatus = {name:"Unknown"};
		}

		callback(null, {
			server: server,
			status: {
				status: matchedStatus.name,
				statusCode: res.statusCode
			}
		});
	});

	if(healthChecker.timeout) {
		req.on('socket', function (socket) {
			socket.setTimeout(healthChecker.timeout.timeout);
			socket.on('timeout', function() {
				isTimeout = true;
				req.abort();
			});
		});
	}

	req.end();
}

module.exports = function() {
	var config;

	return {
		configure: function(sourceConfig, callback) {
			config = sourceConfig;
			callback();
		},
		initialise: function(callback) {
			callback();
		},
		getServerHealth: function(callback) {
			var checkTasks = [];

			_.each(config.groups, function(group, groupName) {
				_.each(group, function(subGroup, subGroupName) {
					_.each(subGroup, function(server, index) {
						var serverWithPathInfo = _.extend({groupName : groupName, subGroupName:subGroupName}, server);
						checkTasks.push(async.apply(checkServerHealth, serverWithPathInfo, config.healthCheckers[server.healthCheck]));
					});
				});
			});

			async.parallel(checkTasks, function(err, responses) {
				callback(err, _.reduce(responses, function(memo, serverResponse) {

					var group = serverResponse.server.groupName;
					if (memo[group] == undefined) { memo[group] = {}; }
					var subGroup = serverResponse.server.subGroupName;
					if (memo[group][subGroup] == undefined) { memo[group][subGroup] = {}; }
					var name = serverResponse.server.name;

					memo[group][subGroup][name] = serverResponse;

					return memo;
				}, {}));
			});
		}
	};
};
