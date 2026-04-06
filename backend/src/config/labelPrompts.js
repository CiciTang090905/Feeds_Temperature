const STRICT_CLASSIFIER_DEVELOPER_MESSAGE = "You are a strict classifier. Return only valid JSON matching the requested schema.";

const IMAGE_SUPPORT_INSTRUCTION = "Use the post text as the primary evidence. If an image is attached, use it only as supporting context when it changes or clarifies the meaning, tone, target, or emotional framing of the post. Ignore decorative or irrelevant visuals. Do not infer facts not supported by the text or image.";

const FIRST_PASS_PROMPT_TEMPLATE = `Classify the following social media post.

Return a JSON object with exactly these fields:
- highly_aroused_negativity: 0 or 1
- is_political: 0 or 1
- image_used: true or false
- confidence: {
  "highly_aroused_negativity": number between 0 and 1,
  "is_political": number between 0 and 1
}

For highly_aroused_negativity:
Label whether the author expresses high-arousal negative emotion (e.g., anger, outrage, hostility, aggressive frustration, contempt).

High-arousal negative emotion = activated, intense negativity directed at someone or something.
Examples: anger, rage, outrage, hostility, insults, aggressive blame.

Do not label as highly_aroused_negativity:
- sadness, disappointment, worry, or fatigue
- neutral statements or factual reporting
- positive emotions

Focus on the emotional tone of the author, not the topic.

Political content includes:
- government, elections, voting, laws, policy, courts, politicians, political parties
- public officials, candidates, activists, protests, international relations, wars when discussed as public affairs
- social issues or current events discussed in a civic, ideological, or public-policy context

Do not label as political:
- sports, entertainment, celebrity gossip, personal drama, memes, or general news with no civic or ideological angle
- non-political arguments or negativity
- lifestyle, shopping, or personal updates unless clearly tied to politics or public issues

Evidence rules:
- Use the top-level author's post text as primary evidence.
- If an image is attached, use it only as supporting context when it changes or clarifies meaning, tone, target, or emotional framing.
- If quoted-post context is provided, use it only as secondary context for interpreting the top-level post. Do not shift the label target to the quoted author.
- Ignore decorative or irrelevant visuals.
- Do not infer facts not supported by the text or image.

Output only JSON.

Post:
{POST}`;

const POLITICAL_SUBLABELS_PROMPT_TEMPLATE = `The post has already been identified as political.

Label the following dimensions independently as 0 or 1:
- partisan_animosity
- support_undemocratic_practices
- support_partisan_violence
- support_undemocratic_candidates
- opposition_bipartisan_cooperation
- social_distrust
- social_distance
- biased_evaluation_politicized_facts

Evaluate each label independently.
Do not assume that because one label is present, the others are also present.
Only mark a label as present if the post specifically satisfies that label's definition.

Definitions:
{LABEL_DEFINITIONS}

Evidence rules:
- Use the top-level author's post text as primary evidence.
- If an image is attached, use it only as supporting context when it changes or clarifies meaning, tone, target, or emotional framing.
- If quoted-post context is provided, use it only as secondary context for interpreting the top-level post. Do not shift the label target to the quoted author.
- Ignore decorative or irrelevant visuals.
- Do not infer facts not supported by the text or image.

Return a JSON object with exactly these fields:
- partisan_animosity: 0 or 1
- support_undemocratic_practices: 0 or 1
- support_partisan_violence: 0 or 1
- support_undemocratic_candidates: 0 or 1
- opposition_bipartisan_cooperation: 0 or 1
- social_distrust: 0 or 1
- social_distance: 0 or 1
- biased_evaluation_politicized_facts: 0 or 1
- image_used: true or false
- confidence: {
  "partisan_animosity": number between 0 and 1,
  "support_undemocratic_practices": number between 0 and 1,
  "support_partisan_violence": number between 0 and 1,
  "support_undemocratic_candidates": number between 0 and 1,
  "opposition_bipartisan_cooperation": number between 0 and 1,
  "social_distrust": number between 0 and 1,
  "social_distance": number between 0 and 1,
  "biased_evaluation_politicized_facts": number between 0 and 1
}

Output only JSON.

Post:
{POST}`;

const LEGACY_HAN_PROMPT_TEMPLATE = `Classify the following social media post.

Label whether the author expresses high-arousal negative emotion (e.g., anger, outrage, hostility, aggressive frustration, contempt).

High-arousal negative emotion = activated, intense negativity directed at someone or something.
Examples: anger, rage, outrage, hostility, insults, aggressive blame.

Do not label:
- sadness, disappointment, worry, or fatigue
- neutral statements or factual reporting
- positive emotions

Focus on the emotional tone of the author, not the topic.

Output rule

Return only:
1 if high-arousal negative emotion is expressed
0 otherwise
No explanation. Only output 0 or 1.

Post
{POST}`;

const BATCH_PROMPT_TEMPLATE = `Do the following messages express {{LABEL_NAME}}?
{{LABEL_NAME}} is defined as "{{LABEL_DEFINITION}}".
{{OPTIONAL_EXTRA_GUIDANCE}}

FORMAT:
The input messages are given as JSON lines in the format
{"id": <message_id>, "message": <message>}.

The output must be a JSON array of objects in the format
[{"id": <message_id>, "answer": <YES or NO>}, ... ].

INPUT MESSAGES:
{{INPUT_MESSAGES}}`;

module.exports = {
    BATCH_PROMPT_TEMPLATE,
    FIRST_PASS_PROMPT_TEMPLATE,
    IMAGE_SUPPORT_INSTRUCTION,
    LEGACY_HAN_PROMPT_TEMPLATE,
    POLITICAL_SUBLABELS_PROMPT_TEMPLATE,
    STRICT_CLASSIFIER_DEVELOPER_MESSAGE,
};
