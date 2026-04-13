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

const SINGLE_LABEL_BATCH_PROMPT_TEMPLATE = `Classify the following social media post for exactly one label.

Label name:
{LABEL_NAME}

Definition:
{LABEL_DEFINITION}

Supporting guidance:
{LABEL_GUIDANCE}

Evidence rules:
- Use the top-level author's post text as primary evidence.
- If an image is attached, use it only as supporting context when it changes or clarifies meaning, tone, target, or emotional framing.
- If quoted-post context is provided, use it only as secondary context for interpreting the top-level post. Do not shift the label target to the quoted author.
- Ignore decorative or irrelevant visuals.
- Do not infer facts not supported by the text or image.

Return a JSON object with exactly these fields:
- {RESPONSE_KEY}: 0 or 1
- image_used: true or false
- confidence: {
  "{RESPONSE_KEY}": number between 0 and 1
}

Output only JSON.

Post:
{POST}`;

const HAN_BATCH_PROMPT_TEMPLATE = `Classify the following social media post for exactly one label.

Label name:
high-arousal negative emotion

Definition:
activated, intense negativity directed at someone or something

Supporting guidance:
Examples: anger, rage, outrage, hostility, insults, aggressive blame. Do not label sadness, disappointment, worry, fatigue, neutral reporting, or positive emotions. Focus on the emotional tone of the author, not the topic.

Evidence rules:
- Use the top-level author's post text as primary evidence.
- If an image is attached, use it only as supporting context when it changes or clarifies meaning, tone, target, or emotional framing.
- If quoted-post context is provided, use it only as secondary context for interpreting the top-level post. Do not shift the label target to the quoted author.
- Ignore decorative or irrelevant visuals.
- Do not infer facts not supported by the text or image.

Return a JSON object with exactly these fields:
- highly_aroused_negativity: 0 or 1
- image_used: true or false
- confidence: {
  "highly_aroused_negativity": number between 0 and 1
}

Output only JSON.

Post:
{POST}`;

const POLITICAL_BATCH_PROMPT_TEMPLATE = `Classify the following social media post for exactly one label.

Label name:
political content

Definition:
content about civic, ideological, governmental, electoral, legal, public-policy, or public-affairs topics

Supporting guidance:
Political content includes government, elections, voting, laws, policy, courts, politicians, political parties, public officials, candidates, activists, protests, international relations, and wars when discussed as public affairs. Do not label sports, entertainment, celebrity gossip, personal drama, memes, general news with no civic or ideological angle, non-political arguments, lifestyle, shopping, or personal updates unless clearly tied to politics or public issues.

Evidence rules:
- Use the top-level author's post text as primary evidence.
- If an image is attached, use it only as supporting context when it changes or clarifies meaning, tone, target, or emotional framing.
- If quoted-post context is provided, use it only as secondary context for interpreting the top-level post. Do not shift the label target to the quoted author.
- Ignore decorative or irrelevant visuals.
- Do not infer facts not supported by the text or image.

Return a JSON object with exactly these fields:
- is_political: 0 or 1
- image_used: true or false
- confidence: {
  "is_political": number between 0 and 1
}

Output only JSON.

Post:
{POST}`;

function buildPostPromptContext(postText, quotedPost) {
    const primaryText = String(postText || "").trim();
    const lines = [
        "[PRIMARY_POST_TEXT]",
        primaryText || "(empty)",
        "[/PRIMARY_POST_TEXT]",
    ];

    if (quotedPost && typeof quotedPost === "object") {
        const quotedText = String(quotedPost.text || "").trim();
        const quotedUrl = String(quotedPost.url || "").trim();
        const quotedTweetId = String(quotedPost.tweetId || "").trim();
        const quotedImages = Array.isArray(quotedPost?.media?.images) ? quotedPost.media.images.filter(Boolean) : [];
        const hasQuotedContext = Boolean(quotedText || quotedUrl || quotedTweetId || quotedImages.length > 0);

        if (hasQuotedContext) {
            lines.push("[QUOTED_POST_CONTEXT]");
            if (quotedUrl) lines.push(`url: ${quotedUrl}`);
            if (quotedTweetId) lines.push(`tweet_id: ${quotedTweetId}`);
            lines.push("[QUOTED_POST_TEXT]");
            lines.push(quotedText || "(none)");
            lines.push("[/QUOTED_POST_TEXT]");
            lines.push("[QUOTED_POST_IMAGES]");
            lines.push(quotedImages.length > 0 ? quotedImages.join("\n") : "(none)");
            lines.push("[/QUOTED_POST_IMAGES]");
            lines.push("[/QUOTED_POST_CONTEXT]");
            return lines.join("\n");
        }
    }

    lines.push("[QUOTED_POST_CONTEXT]");
    lines.push("(none)");
    lines.push("[/QUOTED_POST_CONTEXT]");
    return lines.join("\n");
}

function buildUserMessage(prompt, imageUrl) {
    if (!imageUrl) {
        return {
            role: "user",
            content: prompt,
        };
    }

    return {
        role: "user",
        content: [
            {
                type: "text",
                text: `${prompt}\n\n${IMAGE_SUPPORT_INSTRUCTION}`,
            },
            {
                type: "image_url",
                image_url: {
                    url: imageUrl,
                },
            },
        ],
    };
}

function buildSingleLabelBatchPrompt({ labelName, labelDefinition, labelGuidance, responseKey, postText, quotedPost }) {
    return SINGLE_LABEL_BATCH_PROMPT_TEMPLATE
        .replaceAll("{LABEL_NAME}", labelName)
        .replace("{LABEL_DEFINITION}", labelDefinition)
        .replace("{LABEL_GUIDANCE}", labelGuidance || "(none)")
        .replaceAll("{RESPONSE_KEY}", responseKey)
        .replace("{POST}", buildPostPromptContext(postText, quotedPost));
}

function buildHanBatchPrompt({ postText, quotedPost }) {
    return HAN_BATCH_PROMPT_TEMPLATE.replace("{POST}", buildPostPromptContext(postText, quotedPost));
}

function buildPoliticalBatchPrompt({ postText, quotedPost }) {
    return POLITICAL_BATCH_PROMPT_TEMPLATE.replace("{POST}", buildPostPromptContext(postText, quotedPost));
}

function buildSublabelBatchPrompt({ labelName, labelDefinition, labelGuidance, responseKey, postText, quotedPost }) {
    return buildSingleLabelBatchPrompt({
        labelName,
        labelDefinition,
        labelGuidance,
        postText,
        quotedPost,
        responseKey,
    });
}

module.exports = {
    FIRST_PASS_PROMPT_TEMPLATE,
    HAN_BATCH_PROMPT_TEMPLATE,
    IMAGE_SUPPORT_INSTRUCTION,
    LEGACY_HAN_PROMPT_TEMPLATE,
    POLITICAL_BATCH_PROMPT_TEMPLATE,
    POLITICAL_SUBLABELS_PROMPT_TEMPLATE,
    SINGLE_LABEL_BATCH_PROMPT_TEMPLATE,
    STRICT_CLASSIFIER_DEVELOPER_MESSAGE,
    buildHanBatchPrompt,
    buildPoliticalBatchPrompt,
    buildPostPromptContext,
    buildSingleLabelBatchPrompt,
    buildSublabelBatchPrompt,
    buildUserMessage,
};
