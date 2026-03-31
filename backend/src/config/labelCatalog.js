const EXTRA_LABELS = [
    {
        key: "partisan_animosity",
        column: "partisan_animosity",
        name: "partisan animosity",
        definition: "dislike for opposing partisans",
        extraGuidance: "",
    },
    {
        key: "support_undemocratic_practices",
        column: "support_undemocratic_practices",
        name: "support for undemocratic practices",
        definition: "willingness to forgo democratic principles for partisan gain",
        extraGuidance:
            "Undemocratic practices include reducing polling stations in areas that support opponents, attacking judicial independence, undermining the free press, challenging election legitimacy, or encouraging political violence.",
    },
    {
        key: "support_partisan_violence",
        column: "support_partisan_violence",
        name: "support for partisan violence",
        definition: "willingness to use violent tactics against outpartisans",
        extraGuidance:
            "Examples include threatening or intimidating messages, harassment, or endorsing violence to advance political goals.",
    },
    {
        key: "support_undemocratic_candidates",
        column: "support_undemocratic_candidates",
        name: "support for undemocratic candidates",
        definition: "willingness to ignore democratic practices to elect in-party candidates",
        extraGuidance:
            "Undemocratic candidates may support reducing polling stations in opposition areas, attacking judicial independence, undermining the free press, challenging election legitimacy, or encouraging political violence.",
    },
    {
        key: "opposition_bipartisan_cooperation",
        column: "opposition_bipartisan_cooperation",
        name: "opposition to bipartisan cooperation",
        definition: "resistance to cross-partisan collaboration",
        extraGuidance: "",
    },
    {
        key: "social_distrust",
        column: "social_distrust",
        name: "social distrust",
        definition: "distrust of people in general",
        extraGuidance: "",
    },
    {
        key: "social_distance",
        column: "social_distance",
        name: "social distance",
        definition: "resistance to interpersonal contact with outpartisans",
        extraGuidance:
            "Messages that increase social distance may include terms that increase distrust, distance, insecurity, hate, prejudice, or discrimination.",
    },
    {
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
};
