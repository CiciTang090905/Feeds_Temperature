const { buildStatsFromRow } = require("../src/services/statsBuilder");

describe("buildStatsFromRow", () => {
    test("adds baselines, rounded ratios, and zones to stats metrics", () => {
        const stats = buildStatsFromRow({
            total_posts: 100,
            total_captured: 125,
            highly_negative_arousal: 12,
            political_posts: 27,
            partisan_animosity: 14,
            support_undemocratic_practices: 5,
            support_partisan_violence: 2,
            support_undemocratic_candidates: 3,
            opposition_bipartisan_cooperation: 4,
            social_distrust: 10,
            social_distance: 18,
            biased_evaluation_politicized_facts: 12,
        });

        expect(stats.totalCaptured).toBe(125);
        expect(stats.allPosts.political).toEqual({
            count: 27,
            percent: 27,
            baseline: 17.1,
            ratio: 158,
            zone: "elevated",
        });
        expect(stats.allPosts.highlyNegativeArousal).toEqual({
            count: 12,
            percent: 12,
            baseline: 10,
            ratio: 120,
            zone: "typical",
        });
        expect(stats.politicalPosts.metrics.supportUndemocraticPractices).toEqual({
            count: 5,
            percent: 19,
            baseline: 9.09,
            ratio: 209,
            zone: "high",
        });
    });

    test("uses assumed baselines and shows zero-denominator metrics as 0 percent", () => {
        const stats = buildStatsFromRow({
            total_posts: 0,
            total_captured: 3,
            highly_negative_arousal: 0,
            political_posts: 0,
            partisan_animosity: 0,
            support_undemocratic_practices: 0,
            support_partisan_violence: 0,
            support_undemocratic_candidates: 0,
            opposition_bipartisan_cooperation: 0,
            social_distrust: 0,
            social_distance: 0,
            biased_evaluation_politicized_facts: 0,
        });

        expect(stats.allPosts.highlyNegativeArousal).toEqual({
            count: 0,
            percent: 0,
            baseline: 10,
            ratio: 0,
            zone: "low",
        });
        expect(stats.allPosts.political).toEqual({
            count: 0,
            percent: 0,
            baseline: 17.1,
            ratio: 0,
            zone: "low",
        });
        expect(stats.politicalPosts.metrics.partisanAnimosity).toEqual({
            count: 0,
            percent: 0,
            baseline: 42.61,
            ratio: 0,
            zone: "low",
        });
    });
});
