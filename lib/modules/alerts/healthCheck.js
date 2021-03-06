var _ = require('lodash');
var async = require('async');
var moment = require('moment');

var Recorder = require('../../recorder');
var events = require('../../events');
var notifiers = require('../../modules/notifiers');
var sources = require('../../modules/sources');
var schedulers = require('../../modules/schedulers');

var moduleName = 'healthCheck';

function loadMapper (mapperConfig) {
	return require('../sources/elasticsearch/mappers/' + mapperConfig.type)(mapperConfig);
}

function loadThreshold (recorder, thresholdConfig) {
	return new require('../thresholds/' + thresholdConfig.type)(recorder, thresholdConfig);
}

module.exports = function() {
	var eventName;
	var recorder;
	var scheduler;
	var notifierConfig;
	var name;
	var source;
	var mappers = [];
	var thresholds = [];
	var eventBuilders = [];
	var baseEventInfo = {};

	function mapServerSets(allStatuses){
		return _.reduce(allStatuses, function(memo, group, groupName) {
			memo[groupName] = _.reduce(group, function(memo, subGroup, subGroupName) {
				memo[subGroupName] = _.reduce(subGroup, function(memo, server, serverName) {
						memo[serverName] = server.status;
						return memo;
					}, {});
				return memo;
			}, {});
			return memo;
		}, {});
	}

	function mapServerSetCounts(allStatuses){
		return _.reduce(allStatuses, function(memo, group, groupName) {
			memo[groupName] = _.reduce(group, function(memo, subGroup, subGroupName) {
				memo[subGroupName] = _.reduce(subGroup, function(memo, server, serverName) {
					var statusName = server.status.status;
						memo[statusName] = memo[statusName] ? memo[statusName] + 1 : 1;
						return memo;
					}, {});
				return memo;
			}, {});
			return memo;
		}, {});
	}

	function check() {
		source.getServerHealth(function(err, allStatuses) {
			var eventInfo = {
				serverSets: mapServerSets(allStatuses),
				serverSetCounts: mapServerSetCounts(allStatuses)
			};

			recorder.record(eventInfo);

			var now = moment();
			var thresholdResults = _.map(thresholds, function(threshold){
				return threshold.checkValue();
			});

			var breaches = _.filter(thresholdResults, function(threshold) {
				return threshold.breached;
			});

			var eventInfo = _.extend({
				matchedThreshold: _.first(breaches),
				thresholds: thresholdResults
			}, eventInfo);

			eventInfo.level = eventInfo.matchedThreshold ? eventInfo.matchedThreshold.level : 'info';
			events.emit(eventName, eventInfo);
            scheduler.scheduleNext();
		});
	}

	return {
		configure: function(config, callback) {
			eventName = moduleName + '.' + config.name;

			name = config.name;

 			recorder = new Recorder({ maxRecordings: 3 });
			scheduler = schedulers.createFromConfig(config.schedule, check);
			notifierConfig = config.notifications;
			source = sources.getSource(config.source);

			mappers = _.map(config.mappers, loadMapper);
			thresholds = _.map(config.thresholds, async.apply(loadThreshold, recorder));

			notifiers.registerAlertNotifications(eventName, notifierConfig);

			eventBuilders = _.map(config.eventBuilders, function(config) {
				return new require('../eventBuilders/' + config.type)(config);
			});

			baseEventInfo = {
				site: config.site
			};

			callback();
		},
		initialise: function(callback) {
			scheduler.start();

			callback();
		}
	};
};
