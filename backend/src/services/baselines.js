const PICCARDI_BASELINES = {
    political: 17.1,
    partisanAnimosity: 42.61,
    supportUndemocraticPractices: 9.09,
    supportPartisanViolence: 5.3,
    supportUndemocraticCandidates: 8.44,
    oppositionToBipartisanCooperation: 10.68,
    socialDistrust: 35.63,
    socialDistance: 60.03,
    biasedEvaluationOfPoliticizedFacts: 53.38,
    highlyNegativeArousal: 10,
};

function ratioToZone(ratioPct) {
    if (ratioPct < 75) return "low";
    if (ratioPct < 125) return "typical";
    if (ratioPct < 175) return "elevated";
    return "high";
}

module.exports = { PICCARDI_BASELINES, ratioToZone };
