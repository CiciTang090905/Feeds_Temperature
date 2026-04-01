const { EventEmitter } = require("events");

const emitter = new EventEmitter();
let version = 0;
let lastUpdatedAt = null;

function getStatsEventState() {
    return {
        version,
        lastUpdatedAt,
    };
}

function notifyStatsUpdated(meta = {}) {
    version += 1;
    lastUpdatedAt = new Date().toISOString();

    emitter.emit("stats_updated", {
        version,
        lastUpdatedAt,
        ...meta,
    });
}

function onStatsUpdated(listener) {
    emitter.on("stats_updated", listener);
    return () => emitter.off("stats_updated", listener);
}

module.exports = {
    getStatsEventState,
    notifyStatsUpdated,
    onStatsUpdated,
};
