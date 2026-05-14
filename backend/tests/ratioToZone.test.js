const { ratioToZone } = require("../src/services/baselines");

describe("ratioToZone", () => {
    test.each([
        [0, "low"],
        [24.99, "low"],
        [25, "low"],
        [74.99, "low"],
        [75, "typical"],
        [100, "typical"],
        [124.99, "typical"],
        [125, "elevated"],
        [174.99, "elevated"],
        [175, "high"],
        [300, "high"],
        [500, "high"],
        [null, "no-data"],
    ])("maps %s to %s", (ratio, zone) => {
        expect(ratioToZone(ratio)).toBe(zone);
    });
});
