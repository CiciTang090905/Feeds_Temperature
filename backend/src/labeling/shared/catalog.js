const HAN_STAGE_A_LABEL = {
    requestKey: "han",
    responseKey: "highly_aroused_negativity",
    column: "han_label",
    name: "high-arousal negative emotion",
    definition: "activated, intense negativity directed at someone or something",
    extraGuidance:
        "Examples: anger, rage, outrage, hostility, insults, aggressive blame. Do not label sadness, disappointment, worry, fatigue, neutral reporting, or positive emotions. Focus on the emotional tone of the author, not the topic.",
};

const POLITICAL_STAGE_A_LABEL = {
    requestKey: "political",
    responseKey: "is_political",
    column: "is_political",
    name: "political content",
    definition: "content about civic, ideological, governmental, electoral, legal, public-policy, or public-affairs topics",
    extraGuidance:
        "Political content includes government, elections, voting, laws, policy, courts, politicians, political parties, public officials, candidates, activists, protests, international relations, and wars when discussed as public affairs. Do not label sports, entertainment, celebrity gossip, personal drama, memes, general news with no civic or ideological angle, non-political arguments, lifestyle, shopping, or personal updates unless clearly tied to politics or public issues.",
};

const STAGE_A_LABELS = [HAN_STAGE_A_LABEL, POLITICAL_STAGE_A_LABEL];

const EXTRA_LABELS = [
    {
        requestKey: "partisan_animosity",
        key: "partisan_animosity",
        column: "partisan_animosity",
        name: "partisan animosity",
        definition: "dislike for opposing partisans",
        extraGuidance: "",
    },
    {
        requestKey: "support_undemocratic_practices",
        key: "support_undemocratic_practices",
        column: "support_undemocratic_practices",
        name: "support for undemocratic practices",
        definition: "willingness to forgo democratic principles for partisan gain",
        extraGuidance:
            "Undemocratic practices include reducing polling stations in areas that support opponents, attacking judicial independence, undermining the free press, challenging election legitimacy, or encouraging political violence.",
    },
    {
        requestKey: "support_partisan_violence",
        key: "support_partisan_violence",
        column: "support_partisan_violence",
        name: "support for partisan violence",
        definition: "willingness to use violent tactics against outpartisans",
        extraGuidance:
            "Examples include threatening or intimidating messages, harassment, or endorsing violence to advance political goals.",
    },
    {
        requestKey: "support_undemocratic_candidates",
        key: "support_undemocratic_candidates",
        column: "support_undemocratic_candidates",
        name: "support for undemocratic candidates",
        definition: "willingness to ignore democratic practices to elect in-party candidates",
        extraGuidance:
            "Undemocratic candidates may support reducing polling stations in opposition areas, attacking judicial independence, undermining the free press, challenging election legitimacy, or encouraging political violence.",
    },
    {
        requestKey: "opposition_bipartisan_cooperation",
        key: "opposition_bipartisan_cooperation",
        column: "opposition_bipartisan_cooperation",
        name: "opposition to bipartisan cooperation",
        definition: "resistance to cross-partisan collaboration",
        extraGuidance: "",
    },
    {
        requestKey: "social_distrust",
        key: "social_distrust",
        column: "social_distrust",
        name: "social distrust",
        definition: "distrust of people in general",
        extraGuidance: "",
    },
    {
        requestKey: "social_distance",
        key: "social_distance",
        column: "social_distance",
        name: "social distance",
        definition: "resistance to interpersonal contact with outpartisans",
        extraGuidance:
            "Messages that increase social distance may include terms that increase distrust, distance, insecurity, hate, prejudice, or discrimination.",
    },
    {
        requestKey: "biased_evaluation_politicized_facts",
        key: "biased_evaluation_politicized_facts",
        column: "biased_evaluation_politicized_facts",
        name: "a biased evaluation of politicized facts",
        definition: "skepticism of facts that favor the worldview of the other party",
        extraGuidance:
            "Messages supporting this may partially present political facts or discuss controversial issues with a specific partisan stance.",
    },
];

const EXTRA_LABEL_COLUMNS = EXTRA_LABELS.map((label) => label.column);

module.exports = {
    EXTRA_LABELS,
    EXTRA_LABEL_COLUMNS,
    HAN_STAGE_A_LABEL,
    POLITICAL_STAGE_A_LABEL,
    STAGE_A_LABELS,
};
