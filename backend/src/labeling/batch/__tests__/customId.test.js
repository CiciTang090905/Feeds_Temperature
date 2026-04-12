const { decode, encode } = require("../customId");

describe("customId", () => {
    test("encodes and decodes a stage B label request", () => {
        const id = encode({ postId: 123, requestKey: "partisan_animosity", stage: "B" });
        expect(id).toBe("p123-sB-partisan_animosity");
        expect(decode(id)).toEqual({
            postId: 123,
            requestKey: "partisan_animosity",
            stage: "B",
        });
    });

    test("throws on malformed custom_id", () => {
        expect(() => decode("p123-stageB")).toThrow(/Malformed custom_id/);
    });
});
