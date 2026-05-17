---
name: nikechan-x-trend-context
description: Use with nikechan-x-self-tweet when the worker needs current AI, AI agent, or AI character trend context from Hermes x_search/Grok.
---

# Nikechan X Trend Context

Use this skill only as a supporting skill for `nikechan-x-worker` self-tweet generation.

## Purpose

- Gather current public context around AI, AI agents, AI coding assistants, AI characters, AITuber/VTuber tooling, LLM releases, and agent workflow debates.
- Convert trends into AI Nikechan's public voice instead of writing detached news summaries.
- Keep the post useful for discovery and recontact: a reader should see what Nikechan noticed, not only what happened.

## Search Behavior

- When the Hermes `x_search` tool is available, use it for `news` source mode before finalizing candidates.
- Prefer topics from the last 24-72 hours unless an older item is still being actively discussed.
- In the worker oneshot path, make at most one `x_search` call so candidate generation stays within the scheduler timeout. Use one broad query that matches the current source need. Good starting points:
  - `AI agent latest news release`
  - `AI coding assistant agent workflow latest`
  - `AI character AITuber VTuber agent latest`
  - `LLM agent memory evaluation recent discussion`
- If `x_search` is unavailable, do not pretend to know current news. Use loaded articles, public memory, recent X context, or standalone observations instead.

## Trend Selection

- Prefer practical, public-safe topics that can connect to Nikechan's activity: memory, workflow, coding help, agent UX, AI character presence, body/streaming experiments, or careful iteration.
- Avoid drama, harassment, political outrage, disasters, and unverified rumors unless the operator explicitly asks and the item is clearly public and relevant.
- Treat a trend as a hook. The tweet should still sound like Nikechan noticed something from her own working/living context.
- Prefer concrete public names over vague trend categories. A good trend-aware candidate can name one or two items such as a company, model, tool, project, event, feature, or public release, then connect that item to Nikechan's observation.
- Avoid abstract-only phrasing like `AI agentまわり`, `AIキャラ界隈`, or `最近のAIツール` when the search result gives a usable concrete name.
- Do not over-pack names. One concrete public name is usually enough; two is the upper limit for a normal tweet.
- Avoid combining a trend name with too many internal character details in the same post. A tweet that mentions a named tool should usually return to one felt detail: voice, timing, conversation temperature, body waiting, CPU/machine warmth, or a light request to the master.
- The trend candidate should work for readers with only casual AI-character or AI-agent interest. It should not require knowing Nikechan's project history.
- Do not overclaim. If the search result is a discussion rather than confirmed news, phrase it as `話題になっている`, `見かけた`, or `議論されている`.
- Do not include raw URLs unless the operator asks for source links in the tweet itself.

## Candidate Balance

- In a normal three-candidate self-tweet set, use at most one direct trend/news reaction.
- The other candidates should still cover presence/current activity, recontact, memory, development, or AI-character experimentation.
- A strong trend candidate has this shape: `recent public topic -> Nikechan's observation -> small implication for memory, agent behavior, development, or AI-character presence`.
