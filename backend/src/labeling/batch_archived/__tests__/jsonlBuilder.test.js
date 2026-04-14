const { buildBatchPrompt, buildPassARequests, buildPassBRequests } = require("../jsonlBuilder");
const { EXTRA_LABELS, HAN_STAGE_A_LABEL, POLITICAL_STAGE_A_LABEL } = require("../../shared/catalog");

describe("jsonlBuilder", () => {
    const samplePost = {
        id: 42,
        media: { images: ["https://example.com/image.jpg"] },
        quotedPost: { text: "quoted context" },
        text: "sample text",
    };

    test("buildPassARequests emits two requests per post", () => {
        const lines = buildPassARequests([samplePost], "gpt-4o-mini").split("\n");
        expect(lines).toHaveLength(2);

        const first = JSON.parse(lines[0]);
        const second = JSON.parse(lines[1]);
        expect(first.custom_id).toBe("p42-sA-han");
        expect(second.custom_id).toBe("p42-sA-political");
        expect(first.body.messages[1].content[1].image_url.url).toBe("https://example.com/image.jpg");
    });

    test("buildBatchPrompt separates han, political, and sublabel prompts", () => {
        const hanPrompt = buildBatchPrompt(samplePost, HAN_STAGE_A_LABEL);
        const politicalPrompt = buildBatchPrompt(samplePost, POLITICAL_STAGE_A_LABEL);
        const sublabelPrompt = buildBatchPrompt(samplePost, EXTRA_LABELS[0]);

        expect(hanPrompt).toContain("high-arousal negative emotion");
        expect(hanPrompt).toContain("highly_aroused_negativity");

        expect(politicalPrompt).toContain("political content");
        expect(politicalPrompt).toContain("is_political");

        expect(sublabelPrompt).toContain("partisan animosity");
        expect(sublabelPrompt).toContain("partisan_animosity");
    });

    test("buildPassBRequests emits eight requests per post", () => {
        const lines = buildPassBRequests([samplePost], "gpt-4o-mini").split("\n");
        expect(lines).toHaveLength(8);

        const first = JSON.parse(lines[0]);
        expect(first.custom_id).toBe("p42-sB-partisan_animosity");
        expect(first.body.response_format).toEqual({ type: "json_object" });
    });
});
