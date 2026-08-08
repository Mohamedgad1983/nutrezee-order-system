/* eslint-env node */
'use strict';
const { name, fleetbase } = require('../package');

module.exports = function (environment) {
    return {
        modulePrefix: name,
        environment,
        mountedEngineRoutePrefix: `console.${fleetbase.route}`,
    };
};
