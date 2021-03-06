var expect = require('expect.js');
var async = require('async');
var http = require('http');
var https = require('https');
var fs = require('fs');
var proxyquire = require('proxyquire');

var sources = require('../../../lib/modules/sources');
var notifiers = require('../../../lib/modules/notifiers');
var healthChecker = require('../../../lib/modules/sources/healthChecker');
var healthCheck;

var fakeScheduler = {
    createFromConfig: function(config, task) {
        return {
            start: function() {
                task();
            },
            stop: function() {},
            scheduleNext: function() {}
        };
    }
};

function configureAndInitialiseSource(config, callback) {
    var source = new healthChecker();
    async.series([
        async.apply(source.configure, config),
        source.initialise,
        function(callback) {
            sources.registerSource('healthChecker', source);
            callback();
        }
    ], callback);

    return source;
}

describe('healthCheck', function() {
    var httpserver;
    var httpsserver;
    var responseStatusCode;
    var getResponseStatusCode;
    var responseContent;

    beforeEach(function(done) {
        responseStatusCode = 200;
        responseContent = undefined;
        getResponseStatusCode = function() { return responseStatusCode; };

        notifiers.clear();
        sources.clear();

        healthCheck = proxyquire('../../../lib/modules/alerts/healthCheck', {
            '../../modules/schedulers': fakeScheduler
        });

        async.series([
            function(callback) {
                httpserver = http.createServer(function (req, res) {
                    res.writeHead(getResponseStatusCode());
                    res.end(responseContent);
                });

                httpserver.listen(5555, function() {
                    callback();
                });
            },
            function(callback) {
                var options = {
                    pfx: fs.readFileSync(__dirname + '/server.pfx'),
                    passphrase: 'password'
                };
                httpsserver = https.createServer(options, function (req, res) {
                    res.writeHead(getResponseStatusCode());
                    res.end(responseContent);
                });

                httpsserver.listen(5565, function() {
                    callback();
                });
            }
        ], done);
    });

    afterEach(function() {
        httpserver.close();
        httpsserver.close();
    });

    describe('returns status of configured server', function() {
        it('returns OK status when server is responding as expected', function(done) {
            var alert = new healthCheck();

            notifiers.registerNotifier('test', {
                notify: function(eventName, event) {
                    expect(event.serverSets.team.category['server-01'].status).to.be('OK');
                    done();
                }
            });

            async.series([
                async.apply(configureAndInitialiseSource, {
                    "groups": {
                        "team": {
                            "category": [
                                { host: "localhost", name: "server-01", port: 5555, healthCheck: 'test' }
                            ]
                        }
                    },
                    healthCheckers: {
                        test: {
                            path: "/status",
                            status: [
                                { "name": "OK", statusRegex: '200' }
                            ]
                        }
                    }
                }),
                async.apply(alert.configure, {
                    source: 'healthChecker',
                    notifications: [
                        { "type": "test", "levels": ["info"] }
                    ]
                }),
                alert.initialise
            ]);
        });

        it('returns Unknown status when server is an unknown status', function(done) {
            var alert = new healthCheck();

            responseStatusCode = 500;

            notifiers.registerNotifier('test', {
                notify: function(eventName, event) {
                    expect(event.serverSets.team.category['server-01'].status).to.be('Unknown');
                    done();
                }
            });

            async.series([
                async.apply(configureAndInitialiseSource, {
                    "groups": {
                        "team": {
                            "category": [
                                { host: "localhost", name: "server-01", port: 5555, healthCheck: 'test' }
                            ]
                        }
                    },
                    healthCheckers: {
                        test: {
                            path: "/status",
                            status: [
                                { "name": "OK", statusRegex: '200' }
                            ]
                        }
                    }
                }),
                async.apply(alert.configure, {
                    source: 'healthChecker',
                    notifications: [
                        { "type": "test", "levels": ["info"] }
                    ]
                }),
                alert.initialise
            ]);
        });

        it('returns Error status when server when client cannot connect', function(done) {
            var alert = new healthCheck();

            notifiers.registerNotifier('test', {
                notify: function(eventName, event) {
                    expect(event.serverSets.team.category['server-02'].status).to.be('ERROR');
                    done();
                }
            });

            async.series([
                async.apply(configureAndInitialiseSource, {
                    "groups": {
                        "team": {
                            "category": [
                                { host: "localhost", name: "server-02", port: 5556, healthCheck: 'test' }
                            ]
                        }
                    },
                    healthCheckers: {
                        test: {
                            path: "/status",
                            status: [
                                { "name": "OK", statusRegex: '200' }
                            ]
                        }
                    }
                }),
                async.apply(alert.configure, {
                    source: 'healthChecker',
                    notifications: [
                        { "type": "test", "levels": ["info"] }
                    ]
                }),
                alert.initialise
            ]);
        });

        it('returns Error status when server returns a 500 code', function(done) {
            var alert = new healthCheck();

            responseStatusCode = 500;

            notifiers.registerNotifier('test', {
                notify: function(eventName, event) {
                    expect(event.serverSets.team.category['server-02'].status).to.be('ERROR');
                    done();
                }
            });

            async.series([
                async.apply(configureAndInitialiseSource, {
                    "groups": {
                        "team": {
                            "category": [
                                { host: "localhost", name: "server-02", port: 5555, healthCheck: 'test' }
                            ]
                        }
                    },
                    healthCheckers: {
                        test: {
                            path: "/status",
                            status: [
                                { "name": "OK", statusRegex: '200' },
                                { "name": "ERROR", statusRegex: '5[0-9]{0,2}' }
                            ]
                        }
                    }
                }),
                async.apply(alert.configure, {
                    source: 'healthChecker',
                    notifications: [
                        { "type": "test", "levels": ["info"] }
                    ]
                }),
                alert.initialise
            ]);
        });

        it('returns Error status when server returns an alive: false content', function(done) {
            var alert = new healthCheck();

            responseStatusCode = 200;
            responseContent = '{"alive":true,"stingray":{"alive":false,"currentEndpoint":"https://172.10.10.85:9070"}}';

            notifiers.registerNotifier('test', {
                notify: function(eventName, event) {
                    expect(event.serverSets.team.category['server-02'].status).to.be('ERROR');
                    done();
                }
            });

            async.series([
                async.apply(configureAndInitialiseSource, {
                    "groups": {
                        "team": {
                            "category": [
                                { host: "localhost", name: "server-02", port: 5555, healthCheck: 'test' }
                            ]
                        }
                    },
                    healthCheckers: {
                        test: {
                            path: "/status",
                            status: [
                                { "name": "ERROR", "contentRegex": "\"alive\":false" },
                                { "name": "OK", "statusRegex": "200" }
                            ]
                        }
                    }
                }),
                async.apply(alert.configure, {
                    source: 'healthChecker',
                    notifications: [
                        { "type": "test", "levels": ["info"] }
                    ]
                }),
                alert.initialise
            ]);
        });

        it('returns Timeout status when server request exceeds timeout', function(done) {
            var alert = new healthCheck();

            responseStatusCode = 500;

            notifiers.registerNotifier('test', {
                notify: function(eventName, event) {
                    expect(event.serverSets.team.category['server-02'].status).to.be('TIMEOUT');
                    done();
                }
            });

            async.series([
                async.apply(configureAndInitialiseSource, {
                    "groups": {
                        "team": {
                            "category": [
                                { host: "localhost", name: "server-02", port: 5556, healthCheck: 'test' }
                            ]
                        }
                    },
                    healthCheckers: {
                        test: {
                            path: "/status",
                            timeout: { timeout: 50, status: 'TIMEOUT' },
                            status: [
                                { "name": "OK", statusRegex: '200' },
                                { "name": "ERROR", statusRegex: '5[0-9]{2}' }
                            ]
                        }
                    }
                }),
                async.apply(alert.configure, {
                    source: 'healthChecker',
                    notifications: [
                        { "type": "test", "levels": ["info"] }
                    ]
                }),
                alert.initialise
            ]);
        });

        it('returns Deploying status when server timesout after ', function(done) {
            var alert = new healthCheck();

            responseStatusCode = 500;

            notifiers.registerNotifier('test', {
                notify: function(eventName, event) {
                    expect(event.serverSets.team.category['server-02'].status).to.be('TIMEOUT');
                    done();
                }
            });

            async.series([
                async.apply(configureAndInitialiseSource, {
                    "groups": {
                        "team": {
                            "category": [
                                { host: "localhost", name: "server-02", port: 5556, healthCheck: 'test' }
                            ]
                        }
                    },
                    healthCheckers: {
                        test: {
                            path: "/status",
                            timeout: { timeout: 50, status: 'TIMEOUT' },
                            status: [
                                { "name": "OK", statusRegex: '200' },
                                { "name": "ERROR", statusRegex: '5[0-9]{2}' }
                            ]
                        }
                    }
                }),
                async.apply(alert.configure, {
                    source: 'healthChecker',
                    notifications: [
                        { "type": "test", "levels": ["info"] }
                    ]
                }),
                alert.initialise
            ]);
        });

        it('returns combined groups and subgroups of servers ', function(done) {
            var alert = new healthCheck();

            notifiers.registerNotifier('test', {
                notify: function(eventName, event) {
                    expect(event.serverSets.team.category['server-02'].status).to.be('OK');
                    expect(event.serverSets.web.category['server-03'].status).to.be('OK');
                    expect(event.serverSets.api.services['server-03'].status).to.be('OK');
                    expect(event.serverSets.api.services['server-04'].status).to.be('OK');
                    done();
                }
            });

            async.series([
                async.apply(configureAndInitialiseSource, {
                    "groups": {
                        "team": {
                            "category": [
                                { host: "localhost", name: "server-02", port: 5555, healthCheck: 'test' }
                            ]
                        },
                        "web": {
                            "category": [
                                { host: "localhost", name: "server-03", port: 5555, healthCheck: 'test' }
                            ]
                        },
                        "api": {
                            "services": [
                                { host: "localhost", name: "server-03", port: 5555, healthCheck: 'test' },
                                { host: "localhost", name: "server-04", port: 5555, healthCheck: 'test' }
                            ]
                        }
                    },
                    healthCheckers: {
                        test: {
                            path: "/status",
                            timeout: { timeout: 50, status: 'TIMEOUT' },
                            status: [
                                { "name": "OK", statusRegex: '200' },
                            ]
                        }
                    }
                }),
                async.apply(alert.configure, {
                    source: 'healthChecker',
                    notifications: [
                        { "type": "test", "levels": ["info"] }
                    ]
                }),
                alert.initialise
            ]);
        });

        it('returns count of servers in each state in a group', function(done) {
            var alert = new healthCheck();

            var responseStatusCodes = [ 500, 200, 200, 200 ];
            getResponseStatusCode = function() { return responseStatusCodes.shift(); };

            notifiers.registerNotifier('test', {
                notify: function(eventName, event) {
                    expect(event.serverSetCounts.api.services['OK']).to.be(3);
                    expect(event.serverSetCounts.api.services['ERROR']).to.be(1);
                    done();
                }
            });

            async.series([
                async.apply(configureAndInitialiseSource, {
                    "groups": {
                        "api": {
                            "services": [
                                { host: "localhost", name: "server-02", port: 5555, healthCheck: 'test' },
                                { host: "localhost", name: "server-03", port: 5555, healthCheck: 'test' },
                                { host: "localhost", name: "server-04", port: 5555, healthCheck: 'test' },
                                { host: "localhost", name: "server-05", port: 5555, healthCheck: 'test' }
                            ]
                        }
                    },
                    healthCheckers: {
                        test: {
                            path: "/status",
                            timeout: { timeout: 50, status: 'TIMEOUT' },
                            status: [
                                { "name": "OK", statusRegex: '200' },
                                { "name": "ERROR", statusRegex: '5[0-9]{0,2}' }
                            ]
                        }
                    }
                }),
                async.apply(alert.configure, {
                    source: 'healthChecker',
                    notifications: [
                        { "type": "test", "levels": ["info"] }
                    ]
                }),
                alert.initialise
            ]);
        });

    });

    describe('supports', function() {
        it('https', function(done) {
            var alert = new healthCheck();

            notifiers.registerNotifier('test', {
                notify: function(eventName, event) {
                    expect(event.serverSets.team.category['localhost'].status).to.be('OK');
                    done();
                }
            });

            async.series([
                async.apply(configureAndInitialiseSource, {
                    "groups": {
                        "team": {
                            "category": [
                                { host: "localhost", name: "localhost", port: 5565, healthCheck: 'test' }
                            ]
                        }
                    },
                    healthCheckers: {
                        test: {
                            secure: true,
                            path: "/status",
                            status: [
                                { "name": "OK", statusRegex: '200' }
                            ]
                        }
                    }
                }),
                async.apply(alert.configure, {
                    source: 'healthChecker',
                    notifications: [
                        { "type": "test", "levels": ["info"] }
                    ]
                }),
                alert.initialise
            ]);
        });
    });

    describe('fires alerts', function() {
        it('fires info status when no threshold configured', function(done) {
            var alert = new healthCheck();

            notifiers.registerNotifier('test', {
                notify: function(eventName, event) {
                    expect(event.level).to.be('info');
                    done();
                }
            });

            async.series([
                async.apply(configureAndInitialiseSource, {
                    "groups": {
                        "team": {
                            "category": [
                                { host: "localhost", name: "server-01", port: 5555, healthCheck: 'test' }
                            ]
                        }
                    },
                    healthCheckers: {
                        test: {
                            path: "/status",
                            status: [
                                { "name": "OK", statusRegex: '200' },
                                { "name": "ERROR", statusRegex: '5[0-9]{0,2}' }
                            ]
                        }
                    }
                }),
                async.apply(alert.configure, {
                    source: 'healthChecker',
                    notifications: [
                        { "type": "test", "levels": ["info"] }
                    ]
                }),
                alert.initialise
            ]);
        });

        it('does not fire when servers healthy and configured for 1 failed check', function(done) {
            var alert = new healthCheck();

            notifiers.registerNotifier('test', {
                notify: function(eventName, event) {
                    expect(event.level).to.be('info');
                    done();
                }
            });

            async.series([
                async.apply(configureAndInitialiseSource, {
                    "groups": {
                        "team": {
                            "category": [
                                { host: "localhost", name: "server-01", port: 5555, healthCheck: 'test' }
                            ]
                        }
                    },
                    healthCheckers: {
                        test: {
                            path: "/status",
                            status: [
                                { "name": "OK", statusRegex: '200' },
                                { "name": "ERROR", statusRegex: '5[0-9]{0,2}' }
                            ]
                        }
                    }
                }),
                async.apply(alert.configure, {
                    source: 'healthChecker',
                    notifications: [
                        { "type": "test", "levels": ["info", "critical"] }
                    ],
                    thresholds: [{
                        type: 'maxHealthCheckValue',
                        status: 'ERROR',
                        limit: 1,
                        level: 'critical'
                    }]
                }),
                alert.initialise
            ]);
        });

        it('fires when servers unhealthy and configured for 1 failed check', function(done) {
            var alert = new healthCheck();

            responseStatusCode = 500;

            notifiers.registerNotifier('test', {
                notify: function(eventName, event) {
                    expect(event.level).to.be('critical');
                    done();
                }
            });

            async.series([
                async.apply(configureAndInitialiseSource, {
                    "groups": {
                        "team": {
                            "category": [
                                { host: "localhost", name: "server-01", port: 5555, healthCheck: 'test' }
                            ]
                        }
                    },
                    healthCheckers: {
                        test: {
                            path: "/status",
                            status: [
                                { "name": "OK", statusRegex: '200' },
                                { "name": "ERROR", statusRegex: '5[0-9]{0,2}' }
                            ]
                        }
                    }
                }),
                async.apply(alert.configure, {
                    source: 'healthChecker',
                    notifications: [
                        { "type": "test", "levels": ["info", "critical"] }
                    ],
                    thresholds: [{
                        type: 'maxHealthCheckValue',
                        status: 'ERROR',
                        limit: 1,
                        level: 'critical'
                    }]
                }),
                alert.initialise
            ]);
        });
    });
});
