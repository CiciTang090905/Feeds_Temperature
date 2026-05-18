const { PICCARDI_BASELINES, ratioToZone } = require("./baselines");

const POLITICAL_POST_METRIC_DEFINITIONS = [
    { responseKey: "partisanAnimosity", sourceColumn: "partisan_animosity", sqlAlias: "partisan_animosity" },
    { responseKey: "supportUndemocraticPractices", sourceColumn: "support_undemocratic_practices", sqlAlias: "support_undemocratic_practices" },
    { responseKey: "supportPartisanViolence", sourceColumn: "support_partisan_violence", sqlAlias: "support_partisan_violence" },
    { responseKey: "supportUndemocraticCandidates", sourceColumn: "support_undemocratic_candidates", sqlAlias: "support_undemocratic_candidates" },
    { responseKey: "oppositionToBipartisanCooperation", sourceColumn: "opposition_bipartisan_cooperation", sqlAlias: "opposition_bipartisan_cooperation" },
    { responseKey: "socialDistrust", sourceColumn: "social_distrust", sqlAlias: "social_distrust" },
    { responseKey: "socialDistance", sourceColumn: "social_distance", sqlAlias: "social_distance" },
    { responseKey: "biasedEvaluationOfPoliticizedFacts", sourceColumn: "biased_evaluation_politicized_facts", sqlAlias: "biased_evaluation_politicized_facts" },
];

function buildStatsFromRow(row) {
    const total = Number(row.total_posts) || 0;
    const highlyNegativeArousalCount = Number(row.highly_negative_arousal) || 0;
    const politicalCount = Number(row.political_posts) || 0;
    const politicalMetrics = {};

    for (const metric of POLITICAL_POST_METRIC_DEFINITIONS) {
        const count = Number(row[metric.sqlAlias]) || 0;
        politicalMetrics[metric.responseKey] = buildMetricStats(count, politicalCount, metric.responseKey);
    }

    return {
        totalCaptured: Number(row.total_captured) || 0,
        totalPostsWatched: total,
        allPosts: {
            highlyNegativeArousal: buildMetricStats(highlyNegativeArousalCount, total, "highlyNegativeArousal"),
            political: buildMetricStats(politicalCount, total, "political"),
        },
        politicalPosts: {
            totalPosts: politicalCount,
            metrics: politicalMetrics,
        },
    };
}

function buildMetricStats(count, denominator, baselineKey) {
    const numericCount = Number(count) || 0;
    const numericDenominator = Number(denominator) || 0;
    const baseline = PICCARDI_BASELINES[baselineKey];
    const percent = numericDenominator > 0 ? Math.round((numericCount / numericDenominator) * 100) : 0;
    const ratio = Math.round((percent / Number(baseline)) * 100);

    return {
        count: numericCount,
        percent,
        baseline,
        ratio,
        zone: ratioToZone(ratio),
    };
}

module.exports = {
    POLITICAL_POST_METRIC_DEFINITIONS,
    buildStatsFromRow,
};
