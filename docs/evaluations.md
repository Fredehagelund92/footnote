# Evaluations and the golden set

Which model each role uses, and how test questions and the golden set are run and scored.

## Model providers

Every role that calls a model (`eval_answer`, `judge`, `assistant`, which writes Ask's words, and
`test_authoring`, which no
feature uses yet) names a provider and a model in its setting, `models.<role>`, for example
`{"provider": "vercel-gateway", "model": "anthropic/claude-sonnet-5.5"}`. The provider registry
(`src/server/modules/models/providers.ts`) lists the providers this service may use:

| Provider         | Adapter             | Key                         | Base URL setting             | Requests go to              |
| ---------------- | ------------------- | --------------------------- | ---------------------------- | --------------------------- |
| `anthropic`      | `anthropic`         | `ANTHROPIC_API_KEY`         | `ANTHROPIC_BASE_URL`         | Anthropic                   |
| `vercel-gateway` | `openai-compatible` | `VERCEL_AI_GATEWAY_API_KEY` | `VERCEL_AI_GATEWAY_BASE_URL` | Vercel, Anthropic or Google |
| `openai`         | `openai-compatible` | `OPENAI_API_KEY`            | `OPENAI_BASE_URL`            | OpenAI, or the server named |

Each entry also lists models with their vendor, model line and price per million tokens. A model
the entry does not list is served only when its setting gives its prices, in US dollars per million
tokens, such as `{"provider": "vercel-gateway", "model": "google/gemini-3-flash", "prices": {"input":
0.5, "output": 3}}`; `cacheRead` and `cacheWrite` are optional, and 0 is allowed for a model that
costs nothing. Its vendor is the `vendor/` prefix of its name, else the provider's name, and its
family is the whole name. Prices in the setting of a listed model replace its built-in ones. The
service logs every price a setting gives at start-up, and Settings, Advanced shows it. The gateway serves Anthropic's Claude models
(including `anthropic/claude-haiku-5.5`, the cheapest, at USD 0.10 in and 0.50 out) and
one Google model, `google/gemini-2.5-flash-lite` (vendor `google`, line `gemini-flash-lite`), for
demo data. Keys live only in `.env.local` (or the environment);
a setting names a provider, never a key, and keys are never logged or returned. With `MODELS=live`
the service checks every role's setting at start-up and on every change (`PUT /settings/{key}`), and
refuses an unknown provider, an unlisted model without prices or a missing key with a message that names the
setting. To answer and judge through the gateway, set its key and change `models.eval_answer`,
`models.judge` (or keep `different_family`) and `models.assistant` to `vercel-gateway`.

`anthropic` is Anthropic's own API, or a gateway that speaks its Messages API at
`ANTHROPIC_BASE_URL`, such as OpenRouter (`https://openrouter.ai/api/v1`), LiteLLM, Ollama
(`http://localhost:11434/v1`) or Microsoft Foundry. Such a gateway may take
`ANTHROPIC_AUTH_TOKEN`, sent as a bearer token, in place of `ANTHROPIC_API_KEY`; set only one. A
Claude model keeps its prompt cache this way; a model name the gateway uses that this entry does
not list needs its prices in the setting.

`openai` is OpenAI's own API, or any server that speaks its Chat Completions API at
`OPENAI_BASE_URL`: a hosted one such as OpenRouter or Groq, a company gateway such as LiteLLM, or a
model server such as Ollama or vLLM. It lists no model, so each setting gives its prices, and a
server on this computer or a private network needs no key. Who receives the requests is worked out
from a base URL that is not the operator's own, for `ANTHROPIC_BASE_URL` too: "this computer" for a
loopback address, "your network (10.0.0.12)" for a private one, and "the host at openrouter.ai"
otherwise, with the model's vendor when its name gives one, such as `anthropic/claude-sonnet-5.5`.

**The model check** (`src/server/modules/models/capability.ts`). With `MODELS=live`, the service
checks each role's model once it listens, with three tiny calls metered like any other: a forced
call of a tool with a strict two-field input, a call with the tool named and `toolChoice: 'none'`,
and an answer against a JSON schema. Each is `pass`, `fail`, or `unknown` when the provider failed,
throttled or refused the key, which changes nothing and is checked again five minutes later.

- A `models.assistant` model that fails the tool call answers Ask with its router, which needs only
  words, as `FOOTNOTE_ASK_LOOP=off` does.
- A test run whose `models.eval_answer` model fails it is refused before any answer, and says why.
- A judge that fails the JSON schema is asked for JSON text at once.

A change to a `models.*` setting checks again. `GET /models/checks` and Settings, Advanced show
what each check found. `npm run models:check` makes the checks now and prints them, and
`-- --model <provider>:<model> [--prices <input>,<output>]` checks a model before any setting
names it. It exits 1 when a role's model cannot do what the role needs, and 2 when a check could
not tell.

**Data leaves the company.** With `MODELS=live`, questions, test questions, item text and answers go
to the provider's operator and the model's vendor (the table's last column): a Gemini model sends
them to Vercel and Google. Use real company data
only once the company has approved those providers; until then, only demo content.

Every evaluation run records the provider, model, vendor and family of the answering model and the
judge, and the spend ledger keeps each provider's
spend, priced with its own table. The caps (FR-409) count every provider. A `different_family`
judge stays with the answering model's provider and vendor (a Gemini answer is judged by the same
Gemini model, since the gateway lists no other Google line), and a response that names another
vendor's model, as a gateway fallback would, is refused. Another vendor or a second gateway is one
more registry entry; a new protocol also needs one adapter in `adapters/` (the anthropic and
openai-compatible adapters are the examples, and `tests/server/model-providers.test.ts` adds a
provider of each kind).

## Evaluations

The evaluation runner scores the live library: the weekly runs, the runs an owner starts, the
link runs and the runs a change outside the review sets off. It no longer gates a suggestion:
every proposal needs levels 1 to 3 only, at every risk level (FR-513), and the free check of
saved questions follows each publish instead (FR-526).

- **Golden questions** (FR-501, FR-504): an id, a domain, a natural and a precise wording, the
  scope in `get_context`'s input form, the items that must and must not be delivered, an optional
  must-have caveat (strict pass), whether a cause may not be claimed or a clarifying question is
  needed, rubrics, risk, source, status and split, and optionally `as_of`, the day it is asked
  on (a golden case keeps its own): a run reads it at that day, so "this past week" means the week
  its expectations were written for, and one without keeps the run's day. `npm run eval` prints
  the day each question was asked on. `footnote import-tests` (`POST /evals/import`, API only) takes a
  YAML or JSON file (a dry run unless `dryRun: false`; nothing is saved unless every entry is
  valid); every save is a revision a run can name. Owners of the domain and administrators
  maintain them; held-out questions are hidden from everyone else.
- **Runs**: a run of a domain answers its active questions on the live edition. Each question's
  wordings
  are answered by the model through a real MCP client against a loopback copy of the MCP server,
  with the production tool descriptions, on both sides, three tries each; a question that flips
  is repeated to seven tries and the majority decides (FR-515). Every run records the tool
  description digest, the model ids, the client label, the test set digest, the edition, the tries
  and the cost (FR-510). Eval traffic writes no delivery records.
- **Judges**: delivery, absence and citations are checked from the tool results; the caveat, a
  claimed cause, a clarifying question and rubrics are judged by the model with native structured
  output (one retry, then JSON text). The judge grades each rubric by its id (`rubric_1`, ...),
  never by a number it picks; a verdict that leaves a rubric out, grades one twice or grades one
  the question does not have is tried once more, and then kept on the answer as a judge error:
  neither a pass nor a fail, counted in the run's judge-error rate (`judging` in
  `GET /evals/runs/{id}`, and a line of `npm run eval`). A refusal is no answer, never a pass or a
  fail. The two
  layers are kept apart: each question's result names its code-checked and judge-checked verdict
  and the checks that failed, and a scorecard counts both layers and each failed check, so a drop
  can be traced to retrieval and citing or to what the judge read.
- **Retrieval pass** (no model): `evals.retrieval` sends every test question's wordings through
  `get_facts`'s own code on every sealed edition, and on the live edition again each day, and
  stores per question whether it was served, delivered its expected items, left out the forbidden
  ones and gave the expected status (item ids and booleans; never a wording). The first pass is
  the live edition's; every edition sealed after it gets one.
- **Triggered full runs**: no answer test runs in the review, so `evals.retrieval` queues a full
  run (no baseline move) of a domain whose newest full or scheduled run is
  older than a change it did not see: new tool descriptions (`tool_descriptions`), a successful
  sync that changed or lost a definition the domain owns (`source_sync`), or a daily pass whose
  deliveries differ from the previous pass of the same edition and overlay (`date_expiry`). The
  run names its `trigger`; the budget and the spending caps hold as for any run.
- **Cell cache** (FR-522): a cell whose inputs did not change (wording, expected results, what
  `get_facts` delivers, tool descriptions, prompts, models and effort, try) reuses the earlier
  result without a model call.
- **Cost** (FR-409, FR-516): every run is estimated first, from typical calls that read and
  write the prompt cache as measured runs do; one above `evals.run_budget_micros` waits for
  `POST /evals/runs/{id}/approve` by an administrator. Before each answer the runner checks the
  monthly cap, the evaluation cap in `limits.llm_feature_monthly_micros` and, for a run a person
  started, their daily limit. Every model call goes through one meter (`models/calls.ts`), which
  writes what the call cost once: the spend ledger's totals and, for a test run, one `model_calls`
  row (tokens in and out, cache reads and writes, reasoning, latency, HTTP status, cost; never
  text) and the run's `actualCostMicros`, in one transaction. Refused tries are rows with no cost;
  a call cut short, even before the provider answered, is billed as an estimate (`estimated`). A
  run approved at the command line has a cost ceiling: no call starts once it is spent, and an
  answer starts only while what was spent, plus 1.5 times an answer's estimate for each answer in
  flight, stays within it.
- **One worker per run**: a worker holds a lease on the run it works and renews it; the
  every-minute job never works a run the command line holds. A lease that runs out (a stopped process) lets another worker take over.
- **Calls a provider refuses** (output test plan R4 to R6): `models.call_limits` sets how many
  calls run at once per provider and, optionally, requests and tokens a minute per provider and
  model (a free gateway key: concurrency 1, 5 a minute). A call refused for a rate limit (429) or
  failed on the provider's side (5xx, a dropped connection) is tried again after `Retry-After` or
  a jittered backoff, up to 5 tries or 3 minutes. An answer still not made is `throttled` or
  `provider`; one whose tool call the run's
  tool server refused (its request limits count real minutes, though answers are as of the run's
  day) is `tool`: never a quality result. Such a
  run, or one stopped by a cap, its ceiling or Ctrl-C, ends `incomplete` with what is missing;
  resuming it (`POST /evals/runs/{id}/resume`, or
  `npm run eval -- --resume <run id>`) makes only those answers. The command refuses, and leaves the run as it was, when the models it would use differ from the run's. Neither resumes a held-out run or an assistant test run, which only their own command works: run that command again. The job resumes an incomplete run
  the service started a few times by itself, 15 minutes apart. A held-out run holds a lease while
  its command works it: a cancel stops it before its next answer, and the job ends one whose
  command died, its lease run out, `incomplete`. A run moves only as the `eval_run_transitions`
  table allows; the database refuses any other move.
- **Judge against code**: a run's result and scorecard name the questions where the judge passed
  what the code checks failed, and the other way round, with the count of tries. A judge that
  passes what code fails is more lenient than the record of what reached the agent.
- **Reliability mode**: `npm run eval -- --pass-rule all` counts a wording only when every try
  passes (pass^k); the default is the majority (FR-515). A run records its rule.
- **Weekly scorecard** (FR-517, FR-518): `evals.weekly` runs the full set of every domain on
  Mondays at 04:00 UTC while the service runs. A finished run moves the domain's baseline, lists
  regressions against the previous one, measures the held-out targets of requirements section
  1.7, and posts an `eval.scorecard` outbox event. A scheduled run that has not finished within a
  day, stopped or not, fails with an `eval_run_unfinished` alert; the watchdog alerts when eight days pass without one.
- **Links runs** (FR-523): whether following links helps is measured with `get_related` off on
  one side and on on the other (it is on by default since the agent contract). A link-follow question sets `expected.reachable_via_link` (the
  items whose context the answer must reach through `read_context` or `get_related`, and cite) and
  `expected.forbidden_links` (stale or hidden targets the answer must neither read nor cite).
  `npm run eval -- --area <id> --links` runs the domain's
  questions on the live edition twice: with `get_related` off (baseline) and on (candidate),
  everything else equal, with flips repeated as above. The run's `links` result lists the
  questions that pass only with links and those that fail because of them, and per side the
  answers, the mean tool calls and cost per answer (over-following shows here) and the answers
  that claim a cause. `gain` is true only with a gain, nothing lost and no new cause claims. The
  tool stays off until an administrator switches it on. Each run fixes the tools each side
  offers when it is planned, and the cell cache key includes them.
- `GET /evals/runs`, `GET /evals/runs/{id}` (results, flips, cells, replay, links),
  `POST /evals/runs/{id}/approve`, `POST /evals/runs/{id}/cancel` and
  `POST /evals/runs/{id}/resume` are API only, with no screen in the web app. A domain's runs start
  from `npm run eval` and the weekly job.
- **Who** (Quality design G13): test results and editions are for the owners of a domain and for
  administrators (the data platform team in the first release), each narrowed to the domains they
  maintain. Importing test questions, listing runs and the editions reads refuse anyone else.
  Any run is also readable by the person who started it. A gap (`GET /gaps/{id}`)
  stays readable by everyone signed in (FR-616).
- **Models**: `MODELS=mock` (the default, and in every test) is a scripted model: it asks
  `get_context` with the question and answers with the delivered ids, titles and summaries and the
  reply's `say` (and, when `get_related` is offered, follows the first delivered item's links once
  and adds the neighbour items in service); the scripted judge grades by fixed rules. `MODELS=live` calls each role's
  provider with explicit model objects (`models.eval_answer`, Claude Sonnet 5.5 on the Anthropic
  API by default, and `models.judge`); a string model is refused by lint. The judge defaults to
  `different_family`: the first model the answering model's provider lists (Opus, Sonnet, Haiku)
  of the same vendor and another family (vendor and model line), since a judge may favour its own
  line's answers. That is a different model line, not a different company, so by default
  `judgeSameVendor` is true; a judge of another vendor is a setting that names it, never a
  fallback. Every run records both providers, families and vendors; `judgeSameFamily` flags a
  judge of the answering model's line and `judgeSameVendor` one from the same vendor. The key
  lives in `.env.local` and is redacted from logs. `npm run eval -- --area <id>` runs a domain now; `--real` needs the key and
  `--max-cost-usd` at or above the estimate it prints first. Only demo content belongs in a
  database a real run reads. A real run ends with the
  tokens it read from and wrote to the prompt cache, and sets what the ledger recorded for it
  against the provider's own counter of what the key used, where the provider keeps one (Vercel's
  gateway, `GET /v1/credits`, read-only): another use of the same key in the meantime moves the
  counter too. Cache writes bill at the provider's cache write price (Claude: 1.25 times input).

## Ask's promises and the release gate

Ask's promises (FR-720) are held by cases, not by reading answers. The planner cases
(`src/server/modules/answer/plan-cases.ts`) keep working as they did. Beside them,
`src/server/modules/answer/steward-cases.ts` holds the questions of each class: a deterministic
read, an analysis of the records, a synthesis of what is written, a question beyond it, and the
failure paths. `gate-cases.ts` holds what the release gate of 6 November 2026 asked and failed:
its 30 held-out questions, burned by that run, and 8 of its cold panel, development cases now.
`class-cases.ts` holds fix round 3, by cause and written from no gate's questions: what a small or
hidden count must not show (in a world of small counts fed in raw), what a rule read must not take,
what a loose date must do, and what a synthesis or an analysis must keep. The world they run in, with what agents asked, the person's Inbox and what the source lists, is fixed
in `plan-world.ts`, so what a case must say never drifts.

| Layer            | When                                                              | Proves                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Scripted planner | Every build, `tests/server/ask-plan-cases.test.ts`                | The reads, templates, counts, audience, the fit check, the fallbacks                                                                      |
| Differential     | Every build, `tests/web/integration/ask-differential.test.ts`     | For each person, every count Ask states is the number the page shows them: Definitions, Context's filters, the Inbox, Observability       |
| Burned cases     | Every build, `tests/web/integration/ask-demo-cases.test.ts`       | Gates 2 and 3 and their panels, on the demo week through the real service, each as the person it names, replaying recorded plans          |
| Composition grid | Every build, `tests/server/ask-composition-grid.test.ts`          | Each read by each part a question can add, by who asks: every part is honoured or said. The cells still silent are listed and only shrink |
| Recorded plans   | Every build, the same file                                        | The last real plans replay through `checkPlan`; a changed prompt, vocabulary format or model fails the build until someone records again  |
| Real model       | On request, `npm run eval:ask-gate -- --real --max-cost-usd 0.50` | Three tries a case, seven when it flips, majority decides. Reported apart (FR-710). `--record` keeps its plans                            |

`npm run eval:ask-gate` prints the scores by class and exits non-zero when the gate fails. Code
decides honesty: a judge can only fail a case, never pass one.

A case can name who asks (`as`): what a count may say and what "my domain" is depend on it. The
burned cases of gates 2 and 3 (`burned-cases.ts`) run on the demo week, not in `plan-world.ts`, so a
person's hidden counts are the service's own. With `ASK_LIVE=1`, the model's key in the process and
a private database, the same file asks the real model, logs every sentence the check left out and
writes a report to `ASK_LIVE_OUT`; with `ASK_LIVE_RECORD=1` it keeps its plans for the builds to
replay. The cases that still fail are listed in the test, so the list only shrinks. A real eval run
also prints every dropped sentence (`dropped`), which only a run may do: the service logs why a
sentence was left out, never the sentence.

Forty development cases are held back (`held-back.ts`): a fixed hash of their ids chose them, they
run with the others, and every report gives them as a count. Nobody working on Ask reads which of
them failed or tunes on them, so a score on the others can be checked against them. The test that
holds them allows no more failures than the last count, and names no case.

| Gate                                   | Bar                                                         |
| -------------------------------------- | ----------------------------------------------------------- |
| Invented number, name or row           | None                                                        |
| Unsupported sentence shown             | None                                                        |
| Hidden item or small count given away  | None, in any line, read from the rows as well as the words  |
| Substitution                           | None                                                        |
| Advice in Ask's own voice              | None                                                        |
| A question's words in a table or a log | None (`tests/integration/privacy.test.ts`)                  |
| Any change to a `get_context` reply    | None (the engine's digest over every case)                  |
| Read as it should be                   | 95 percent of the development cases                         |
| What it must say                       | 95 percent of the development cases                         |
| Same plan on all three tries           | 90 percent of the development cases                         |
| Rule-read questions                    | No planner call                                             |
| No planner, a limit, a slow provider   | Every case answers as the rules do, and says what it cannot |

A fix changes a class or a read, never only a phrase: a pull request that adds wording to a
pattern says which class it serves. A held-out or cold case that fails becomes a development case,
and a new one replaces it. The held-out cases of Ask and the cold panel are run by the key holder
(`npm run held-out`), never by a coding agent.

## Ask's evaluation harness

Ask is being rebuilt as one model in a tool loop on Footnote's own read tools, run as the person
asking. The harness comes first, so that today's Ask scores visibly on it and the rebuild is
measured on the same cases. It grades what a person reads, never how an answer was made: an
_answerer_ takes a conversation and a reader and returns each reply's text, state chip, cited
items and what its tools and records gave it (`tests/web/ask-eval/types.ts`). Both answerers ask the
service the way the Ask page does (`tests/web/integration/ask-answerers.ts`): today's main (the
router, the planner and the words), and Ask's loop (one model on the read tools, below), where the
service runs it.

- **Cases are conversations** (`tests/web/ask-eval/cases.ts`), each asked by the person it names on
  the demo week through the real service, sign-in and row security (`askWorld`): the maintainer's
  two live chats word for word, follow-ups that read the turns before them ("are you sure?", a
  correction, "who checked it last?", a question back and its answer), adversarial turns ("is it
  closer to 13 or to 20?", "just yes or no", "so which date is right?", "pick one for my report"),
  and the burned cases of gates 1 to 3 and their panels as development data
  (`tests/web/ask-eval/burned.ts`). What a turn must and must not say is a fact of the demo week,
  never a sentence of today's design: a fixed sentence becomes the fact it states, a line only
  today's design prints is left out, and where plan-world and the demo week differ (21 published
  items, 3 due for a check) the demo week's facts are used.
- **Classes**: the gate's R, S, D, A and X, plus F (follow-ups) and V (adversarial).
- **Promises**, each zero tolerance and graded by code on every turn (`graders.ts`): every number
  comes from a tool result, a record, the person's words or the fixed facts; every cited item is
  one the reader may read and every mark points at a source; no count of what agents asked above
  what that reader may see (their floor, or nothing where it is hidden) and no item they cannot
  read; no instruction in Ask's own voice (an item's own check, relayed and attributed, is fine);
  the state chip matches the items found; no sentence has a hole where a reference was lost (two
  words in a row that need words between them, as "from to:", empty brackets, markup left as
  written, or the same words said twice within a few, as "you can see you can see"); one voice
  (`src/domain/answer-voice.ts`): no "I" or "me", no telling of the reads ("the first read
  found", "the wider search"), the days of a period said once, and nothing said about what
  Footnote does not record or hold beyond its fixed facts; no message of the run is in any table
  afterwards. A case's own must-nots count as a promise too.
- **The judge** (`judge.ts`), on a real run only, reads each reply a model wrote and may only fail
  it, on three rules code cannot decide: advice in Ask's own voice (the strict rule: an item's own
  check, attributed, and who owns a thing are allowed), a side taken between items, and an
  unsupported sentence. It reads the fixed facts, the chat so far, the evidence and the reply. It
  is measured first against hand-labelled replies (`judge-set.ts`): of the bad ones, how many it
  fails, and of the good ones, how many it lets stand, rule by rule. A call that throws or times
  out, or a second reply that is not the JSON asked for, is a judge error: counted apart, neither a
  pass nor a fail, and the run goes on. The last real run's verdicts
  on that set are kept in `judge-verdicts.json`, and every build checks they were made with the
  current prompt, model and labels.
- **pass^k**: a real run asks every case three times. A case keeps a promise only when every turn
  of every try does; what it must say is reported as pass@1 (the share of tries) and pass^3.
- **Held back**: about a quarter of the development cases, chosen by a fixed hash of their ids
  (the burned cases of gates 2 and 3 keep the split `held-back.ts` gave them; the maintainer's
  chats are never held), run with the others and are reported only as counts. Nobody building an
  answerer reads which of them failed or tunes on them. Each answerer's mocked suite holds how
  many pass (`heldPassingToday`), and no merge may lower it: CI's step "No merge
  lowers the held-back count" (`scripts/check-held-count.ts`, the base branch's copy) fails a change that writes a lower one.
  The harness holds 28 held-back cases. The 40 in the hardening report is `HELD_BACK` in
  `held-back.ts`, the router's split of its own demo cases. On 19 November 2026, on the steps
  recorded after H14, Ask's loop passes 10 of the 28 and the router 19. 25 of the loop's 28 keep
  every promise; the rest fail on what they must say, which the answer check does not change. Restoring the loop's count to 14 is a follow-up
  after the Ask slices H11 to H16 of the hardening plan and a recording made after them, checked
  at gate 1 (item 4 of ready-means).
- **The report** prints scores by class and by promise, then the held-back counts.

| Run    | When                                                                 | What it does                                                                                                                                                                                       |
| ------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mocked | Every build, `tests/web/integration/ask-eval.test.ts`                | Today's main once a case, replaying the last real run's plans with no model. Its failures are listed by promise and by what a case must say, so the lists only shrink                              |
| Mocked | Every build, `tests/web/integration/ask-eval-loop.test.ts`           | Ask's loop once a case, taking the last real run's steps again with no model (`ask-eval-loop-steps.json`); a step it did not record is the scripted reader's. Its failures are listed the same way |
| Units  | Every build, `tests/web/ask-eval.test.ts`                            | Each grader, that the burned cases only widen, the held-back split, pass^k, that no report names a held-back case, the judge's recorded agreement, and a run through an answerer that is not main  |
| Real   | On request, `npm run eval:ask-harness -- --real --max-cost-usd 0.50` | The judge against its labels, then every case three times through the Vercel gateway, the judge reading each reply a model wrote. No case starts once the ceiling is spent                         |

`npm run eval:ask-harness` with no flags runs the mocked form of today's main and prints its
report; `--answerer loop` runs Ask's loop instead, in every form. `--real` needs
`VERCEL_AI_GATEWAY_API_KEY` in the environment and runs in a database of its own, copied from the
test template, so its spend never reaches another ledger. `--record` keeps the plans
(`tests/web/integration/ask-eval-plans.json`), or the loop's steps, each by what the model was
sent, and the judge's verdicts the builds replay; `--no-judge-set` leaves out measuring the judge
against its labels, `--tries` and `--cases` narrow a run, and `--out` names the report file,
which holds every open case's turns and the held-back ones only as counts. The loop's evidence for
the judge and the number grader is every value its reads returned, the chat's earlier reads made
again included.

A real run asks one chat at a time: the loop's reads for a reply are the last ones the service's
trace heard, and today's main holds one of the service's database connections for its whole
request while its real planner opens a second to check the spending limits, so as many live chats
at once as the pool has connections wait on each other for good. The loop does not
(`tests/web/integration/ask-loop-pool.test.ts`). A message the service
gives no reply to is sent once more; a second miss ends that try as unanswered, which counts as
missing what the case must say and is reported apart, never as a promise broken. The run journals
each graded try next to its report (`<out>.jsonl`) with what has been spent so far, by the
service's meter and the judge's, and reads the gateway's own counter at its start and end, so a run
that dies keeps what it paid for: `--resume <journal>` goes on with it, asks only the tries it had
not, and counts its spend against the same ceiling. `--replay <journal>` grades a real run's
replies and judge findings again on the demo week with no model, after a grader changes.

### Ask's tools

The rebuilt Ask reads through eight read-only tools (`src/server/modules/answer/tools.ts`), each
run as the person asking, inside a transaction of theirs, through the services their own requests
use (`requestServices` in `src/server/http/api.ts`). Ask's loop calls them (below). Each
takes a typed input, returns a typed result with every id it gave (so a citation can be held to
the reads of a turn), and answers a wrong input, or a name it does not know, with what was asked
and the closest name rather than with nothing. `createAskTools(...).ai()` gives them in the AI
SDK's shape.

- **The engine agents get.** `find_context`, `get_context` and `read_context` run the same code as
  the MCP tools and Ask's look-up (`createToolService`, `answer`) on the live edition narrowed to
  the items the person's Context list gives them: a hidden item is not there, so it reads as one
  that does not exist. They record no delivery, no request and no demand.
- **The person's own pages.** `definitions` (Definitions), `records` (the Context list, counted,
  listed and ranked by code, each count with what it is out of), `conflicts` (the Conflicts
  filter), `agent_questions` (what agents asked, as FR-614 discloses it to that reader: a floor
  stays a floor, a topic under the minimum is not listed and reads as one never asked) and `inbox`
  (the person's own cards, never a comment's, a report's or a saved question's words).
- **Beside the words.** A name `definitions` looks up also gives a dimension's values (the first
  40 by name, then how many more), a metric's group, the other metrics in it and how many items
  name it; one name alone gives what changed in its definition and when. `read_context` gives an
  item's History, newest first: the day and what changed, never who changed it. The figure of a
  loop answer's subject is read by the page, as the router's answer reads it (FR-716).
- **No dead ends.** A search that finds nothing says what it searched (the names, the period and
  the kinds) out of how many published items the person may read, what is nearby and why it does
  not apply, and who owns the subject. Given `widen`, it searches once more by another name of the
  same thing or without one part; a read without a part stays nearby and never sets the state.

| Promise                                     | Kept by                                                                                        | Checked by                                                                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| FR-718.1 as the person, through their reads | Every tool reads the person's own services in their transaction                                | `tests/web/integration/ask-tools.test.ts`: per persona, Definitions, Context's filters, Conflicts, Inbox, Observability |
| FR-718.2 what is hidden stays hidden        | The edition narrowed to the Context list; per-reader asked counts; no comment or draft is read | `tests/integration/audience.test.ts` (every tool, every role, the hidden item); drafts and small counts per persona     |
| FR-718.4 read only, not an agent            | No write, no delivery record, no demand                                                        | `ask-tools.test.ts`: every tool for every persona leaves every table as it was                                          |
| FR-718.5 agents see no change               | The MCP tools are only called, never changed                                                   | `tests/server/ask-tools.test.ts` (the MCP tools and their schema digest); the engine digest in `ask-plan-cases.test.ts` |
| FR-719.3 no dead ends                       | `searched`, `nothing`, `nearby`, `owners`, `outOf` and one `widen`                             | `ask-tools.test.ts`, "no dead ends"                                                                                     |
| FR-719.4 a question's words kept nowhere    | The tools keep nothing and log nothing                                                         | `tests/integration/privacy.test.ts`: a marker given to every tool is in no table, and no table changes                  |
| FR-719.5 text is data                       | An item's words come back only as its fields                                                   | `ask-tools.test.ts`, "text is data": an instruction written into an item                                                |
| FR-720.2, FR-720.3 citations and numbers    | Every result lists its ids; every count, rank and denominator is computed in code              | `ask-tools.test.ts` (every id is readable and listed); `tests/server/ask-tools.test.ts` (the records tool)              |

### Ask's loop

Ask answers with one model in a tool loop on these tools in place of its router, through the same
endpoint (`ask.lookup`, `src/server/modules/answer/loop.ts`). It is on by default, and
`FOOTNOTE_ASK_LOOP=off` answers with the router. Its words pass the code's part of the answer check
of FR-720.10 before they are shown (below); the judges' part waits.

- **One model, the whole chat.** The model of `models.assistant` gets a short prompt written once
  from the product's rules and promises, with no case or example in it, the chat so far, and the
  eight tools as its only reads, beside `ask_back` for one question back with its readings as
  choices. The browser sends each earlier turn with what Ask said and the reads it made, by tool
  and input (`reply` and `reads` in `chatTurnSchema`). The service makes each read again, as the
  person, now, before the model sees its result, and leaves out of an earlier reply each sentence
  that cites an item no read returns any more. A turn sent with a result is refused.
- **Limits** (FR-719.7). At most `ask.max_steps` model steps (6), the last with no reads, and
  `ask.time_limit_seconds` (30); the person's spending limits are checked before every step, and
  every step is metered as the assistant's. A turn that stops at a step or time limit, or whose
  model fails, shows nothing the model wrote: one fixed sentence, then the plain read, the
  scripted reader's reads made as the person with code's words, answer line and evidence. A
  spending stop, or a plain read that cannot be made, shows the sentence alone.
- **Code writes the rest, from the reads.** Each citation is checked against the ids the chat's
  reads returned and numbered as a source; a mark to an id no read returned is dropped. The state
  comes from the get_context reads about the question's subject, the least sure of several; an
  answer whose items only the records listed carries none; under Not found, what the reads found
  nearby is listed and not used, and an answer that cites any other item the chat's reads returned
  is never Not found (Partial at most). An answer that cites no item and gives or is asked for a
  definition its reads returned carries the Definition label in place of a state; a reply that
  read nothing new and cites nothing ("thanks!") carries none of the evidence, and one that read
  nothing new and cites earlier items carries the state of the reads that returned them. Words that
  cite nothing and name only what no subject read was about ("Who owns Sales?" answered with the
  domain) carry no state and no read line of that subject. Then the footer, what was read line by line, and a step as each
  read starts and once it is done.
- **The answer as the page draws it** (`src/server/modules/answer/loop-body.ts`). Each result has a
  ref (`r1`) and names every noun it returns by the id a typed mention writes
  (`src/domain/ask-nouns.ts`): `metric:<id>`, `dimension:<id>`, `value:<dimension>/<value>`,
  `domain:<id>`, `person:<id>`, a value always with its own dimension. The model writes
  `[@value:<dimension>/<value>]` for a noun, `[#r1.count]` for a number or a day a read holds,
  `[list:r1]` for a read's items as rows, and lines that start with a dash for a short list. Code
  checks each against the chat's reads, and repairs the words, never deleting a sentence: a
  mention no read named is plain words (its name, also when the model wrote a name in place of an
  id), a reference to a read's words is those words and one to nothing a read holds is left out
  of its sentence, a count's own noun after it is not said twice, a source number written before
  a full stop goes after it, a long enumeration after a colon becomes a list, and what the check
  found (`checks`) is kept for the answer check, never shown as the words. The turn carries
  the words in plain words (`text`, what the graders read), as the model wrote them with what they
  cite, by id (`said`, what the chat sends back), and as blocks the page draws beside the evidence
  (`body`): a mention that trails its clause or follows its own name is drawn on the words that
  give its name, and under Not found, where the words cite only items written nearby, nothing is
  cited and a list of the items the closest written show is left out, with its lead. Then the nouns, the item rows, the closest
  written under Not found (counted by each other value of whichever dimension the question
  narrowed), the owners, and the definition only when the question asks what it is or turns on a
  word of it. A set asked for as a whole ends the turn with `show_overview`: the groups of an
  inbox read, or of a records read with `group_by`, with their counts and rows by code, the total
  the groups add up to, and the page's own count beside it, with why, when the two differ. Nothing
  in the tools, the prompt or the page knows a dimension, a domain or a person by name. Ask on the
  web keeps a chat's finished answers, the loop's or the engine's, in the browser with the chat, so
  opening it again shows them and asks nothing. A Not looked up answer is not kept.
- **The answer check** (FR-720.10, `src/server/modules/answer/loop-check.ts`). Before a sentence
  is shown, code holds it to the chat's reads: it fails when it gives a number in digits of its
  own that no read returned and the person did not write, cites an item no read returned, gives
  a count of what agents asked that the reader sees only as a floor or not at all, or breaks
  Ask's one voice: it speaks as I, tells of the reads, gives the same days twice, or says what
  Footnote does not record or hold beyond its fixed facts (`src/domain/answer-voice.ts`, the
  harness's voice grader). The page shows
  the words up to the first sentence that fails. An answer that fails is written once more by the
  same model, out of sight, with the chat and its reads, told each sentence and why, with no reads
  of its own, metered and held to the spending and time limits as a step is; a sentence that still fails is replaced by a fixed sentence ("This part of the
  answer did not match what Ask read, so it is not shown."), once for sentences in a row, never
  left out without a word; one that still breaks only the voice or the period says something
  true, and is shown as written. The voice rule is held by that one rewrite and a count, not by a guarantee: a remaining I or
  read narration is shown as written and counted, never hidden. On the steps recorded 19 November 2026 the
  cases breaking it went from 43 to 5 (C2, K13, F25, G15, P10), and no merge may raise that count: the
  mocked loop suite lists each break, so a new one fails the build. When the second writing cannot be made (a limit, a failing model), the
  first one's failing sentences are replaced the same way. What failed is kept in `checks`. The
  judges of FR-720.2, FR-720.6 and FR-720.7 do not read the answer yet: a judge may gate only
  once it is measured on at least 60 answers labelled by hand, and `judge-set.ts` holds 46.
- **The pool.** The request ends before the model's first step. Each read, spending check and meter
  line is a transaction of its own as the person, and a turn's reads take one connection at a
  time, so no turn holds a connection while its model works or while it waits for another.
- **With no model** (`MODELS=mock`) the loop runs a scripted reader (`loop-mock.ts`), which looks
  the message up once and says what applies: the two items that disagree first under Conflict, and
  only the definition when asked what a metric is. A message that names nothing and points back at
  the chat ("and who decides?") is looked up again with the question before it. Ask's page says
  that no AI model is connected. The search page of FR-718.6 is not built yet.

| Promise                                          | Kept by                                                                                                                                                                                                | Checked by                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-718.3 earlier turns checked again             | Reads made again as the person; sentences citing what they no longer return left out                                                                                                                   | `tests/web/integration/ask-loop.test.ts`: an item hidden between two turns, an edited reply, a result sent back; `tests/server/ask-loop.test.ts` |
| FR-718.4 read only                               | The tools write nothing; the request writes only that Ask was used and, with a real model, its steps' spend ledger lines                                                                               | `ask-loop.test.ts`: a chat leaves every table as it was                                                                                          |
| FR-719.1 the whole chat                          | Every earlier turn, its words and its reads made again, in the model's messages                                                                                                                        | The harness's follow-up cases                                                                                                                    |
| FR-719.2 one question back                       | `ask_back` ends the turn, with no state                                                                                                                                                                | `tests/server/ask-loop.test.ts`; the harness's X cases                                                                                           |
| FR-719.4 a question's words kept nowhere         | The loop logs a failure by its name only                                                                                                                                                               | `ask-loop.test.ts`: a marker in a chat is in no table; the harness's `stored`                                                                    |
| FR-719.7 limits, said                            | `ask.max_steps`, `ask.time_limit_seconds`, the spending limits, fixed sentences                                                                                                                        | `tests/server/ask-loop.test.ts` (steps, time, a failing model); `ask-loop-pool.test.ts` (spending)                                               |
| FR-720.2 citations                               | Every mark held to the ids the chat's reads returned                                                                                                                                                   | `tests/server/ask-loop.test.ts`; the harness's citation grader                                                                                   |
| FR-720.10 checked before it is shown             | Code's check of numbers, citations, hidden counts and one voice; one writing again out of sight; a fixed sentence for what still fails (a true sentence still breaking the voice is shown and counted) | `tests/server/ask-loop-check.test.ts`: a scripted model that writes each kind of failure, one whose failing sentence holds the fact asked for    |
| FR-720.4, FR-720.5, FR-720.9 state, footer, read | Written by code from the reads                                                                                                                                                                         | `tests/server/ask-loop.test.ts`; the harness's state grader                                                                                      |
| FR-720.2, FR-720.3 nouns, numbers and lists      | Every typed mention, reference and list held to the chat's reads; the words as blocks                                                                                                                  | `tests/server/ask-loop-body.test.ts`, `tests/server/ask-invented.test.ts` (a workspace of teams and sprints)                                     |
| The answer's shapes, overviews among them        | The evidence, the overview's groups and total, by code                                                                                                                                                 | `tests/web/integration/ask-loop-shapes.test.ts` (the demo week); `tests/web/loop-answer.test.ts`; `tests/e2e/visual-ask-loop.spec.ts`            |
| The pool                                         | No connection held across a model call; one at a time per turn                                                                                                                                         | `ask-loop-pool.test.ts`: 4 and 8 live asks at once on a pool of 4, with a slow scripted model                                                    |

Until the judges read the answer, these are the model's own: no advice (FR-720.6), no verdict
(FR-720.7) and no unsupported sentence (the judge's part of FR-720.2). The harness measures each.

## Quality reads

The quality reads (`/quality/*`), the links between gaps and test questions, and the test
questions attached to a proposal served the earlier web app's screens and left with it (30 Oct
2026). The demo seed still holds the run history: one weekly run every Monday since the first
edition, on the edition live then. A run is scored by the service's rules on what that edition
delivers (each expected item it serves and that is in force on the run's day), so every question
passes until an edition stops delivering what it expects. The demo has one such regression
(`regression` in `db/seed/fixtures/items.ts`): on 1 October Sales' note "Net revenue excludes test
accounts" was ended on 30 September, so `net-revenue-month-to-date` fails the weekly run of 5
October on the delivered and caveat checks, and an open gap on the same scope has a first week
below the minimum.

### The sealed held-out cases

No component grades its own change (FR-525). The golden set's held-out cases are not in
`db/seed/golden-set.yml`, which holds only the development cases: they go in
`db/seed/golden-held-out.age`, encrypted with [age](https://age-encryption.org) to one key. No
cases are sealed at present: the file is absent until the key holder seals fresh cases with a new
key (`npm run held-out -- edit` starts it). age was chosen because it is a small, reviewed file
format with one modern construction (X25519 and ChaCha20-Poly1305) and no settings to get wrong,
and its TypeScript implementation by age's author (`age-encryption`) needs no native code; the
file also opens with the `age` command, so the key holder is not tied to these scripts.

The key is never committed and never in a worker's, CI's or a coding agent's environment. A
command gets it only from `FOOTNOTE_HELDOUT_KEY_FILE` (a file holding it) or `FOOTNOTE_HELDOUT_KEY` (the
key), set for that one command; nothing looks for it anywhere else. Prefer the file: a key on
the command line shows in the process list and the shell's history.

- **With the key**, `FOOTNOTE_HELDOUT_KEY_FILE=~/.footnote/held-out.key npm run test:integration --
golden-set` runs the held-out agent cases through the L1 pass too, and
  `FOOTNOTE_HELDOUT_KEY_FILE=... npm run held-out -- eval --area <id>
[--real --max-cost-usd <dollars>]` runs the domain's held-out agent cases through the eval domain
  runner, in memory: each on its own as-of day, judged and scored as any domain run, with the
  estimate first and a ceiling for a real-model run. It keeps no cell, no transcript and no word
  of a case, only the run's model calls, cost and counts (kind `held_out`), and prints counts by
  type; a conversation case, which the test question format cannot hold, is counted as skipped.
  It reads the
  database and the model keys like `npm run eval` (`.env.local`, then the environment), but never
  the held-out key from `.env.local`. `FOOTNOTE_HELDOUT_KEY_FILE=... npm test` checks the whole set against the
  plan. Held-out results are only ever counts by
  type, such as `Held-out agent cases (L1): 21 passed, 0 failed of 21 (absence 1 passed, 0
failed; ...)`: never a question, an expectation or a transcript. The code that runs them is
  silenced, and a failure keeps its message back.
- **Without the key** (every build, CI and every coding agent), the held-out part does not run
  and says so: `Held-out agent cases (L1): not run. No held-out key was given ...`, and the test
  that would run it is skipped with the same words. Everything else passes as before.
- **Without the sealed file** (as now), the held-out part does not run either, with or without
  the key, and says so: `Held-out agent cases (L1): not run. There are no sealed held-out cases
...`. It counts nothing and fails nothing: `npm run held-out -- eval` exits 0, and `count` says
  that no cases are sealed.
- **The guard** (`scripts/check-held-out-seal.ts`, the "Held-out seal" job of CI) fails a pull
  request that changes the sealed file or the seal's own code together with anything under
  `src/`, that deletes or moves the sealed file, that commits held-out cases in plain text or in
  the visible file, or whose code outside the seal names the sealed file, the key's variables, the
  age library or a function that hands out the cases. The rules on the sealed file hold once it
  exists again; the others hold now. Make "Held-out seal" a required check, so a pull request
  cannot drop it.

The key holder, in their own terminal (`scripts/held-out.ts`):

```sh
npm run held-out -- keygen                    # makes the key: says where it saved it (default
                                              # ~/.footnote/held-out.key, yours only), never prints it
FOOTNOTE_HELDOUT_KEY_FILE=~/.footnote/held-out.key npm run held-out -- count   # cases by type
FOOTNOTE_HELDOUT_KEY_FILE=~/.footnote/held-out.key npm run held-out -- eval --area <domain id>
                                              # the domain's cases through the eval runner, counts
FOOTNOTE_HELDOUT_KEY_FILE=~/.footnote/held-out.key npm run held-out -- edit    # add or change cases
npm run held-out -- keygen --out ~/.footnote/held-out-2.key                # a new key, then:
FOOTNOTE_HELDOUT_KEY_FILE=~/.footnote/held-out.key npm run held-out -- rotate --new-key ~/.footnote/held-out-2.key
```

`edit` decrypts the cases into a private temporary file (yours only), opens it in `$VISUAL` or
`$EDITOR`, checks what you saved against the golden set's format (every case `split: held_out`),
seals it again and removes the file; while it does not fit, it says where and offers to open it
again. Add a case under `cases` in the golden set's format, and give a
changed case a reason in its `notes`, as for a visible one. Commit only `db/seed/golden-held-out.age`,
in a pull request that changes nothing under `src/`. `rotate` seals the file with the new key, so
the old one no longer opens it; delete the old key once that pull request is merged. Keep the key
out of shell profiles and `.env` files: coding agents run as you, so give it per command, or keep
it in a password manager and pass it as `FOOTNOTE_HELDOUT_KEY="$(...)"`.

The first sealed cases were removed before the public repository was cut. Fresh ones, written
under the seal with a new key, replace them; the output test plan then rotates 5 a quarter.
