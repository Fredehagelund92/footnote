---
title: Choose a model provider
line: The ways to reach a model, the models tested so far, and who receives what Ask and the test runs send.
group: Run the service
order: 3
reviewed: 2026-11-19
---

Ask and the test runs answer on a real model once you start Footnote with `MODELS=live`. Claude is the model Footnote is built and tested on. Other models work, and their answers are less complete: the [tested models](#tested-models) say by how much. Without `MODELS=live`, scripted models answer and nothing leaves this computer.

## Ways to reach a model

Each way is one line at the start, as [Self-host Footnote](self-hosting.md#ask-on-a-real-model) shows. Anthropic's own API stays the default.

| Way to reach the model                               | Set                                                        | Covers                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Anthropic's API                                      | `ANTHROPIC_API_KEY`                                        | Claude, straight from Anthropic                                                      |
| Any server that speaks Anthropic's Messages API      | `ANTHROPIC_BASE_URL`, with a key or `ANTHROPIC_AUTH_TOKEN` | OpenRouter, LiteLLM, Portkey, Cloudflare, Microsoft Foundry, Ollama, LM Studio, vLLM |
| OpenAI's API                                         | `OPENAI_API_KEY`                                           | OpenAI's models                                                                      |
| Any server that speaks OpenAI's Chat Completions API | `OPENAI_BASE_URL`, and a key if it needs one               | OpenRouter, LiteLLM, Groq, Mistral, DeepSeek, vLLM, LM Studio, llama.cpp, Ollama     |
| Vercel AI Gateway                                    | `VERCEL_AI_GATEWAY_API_KEY`                                | Claude and Gemini, each served only by its own vendor                                |

`FOOTNOTE_MODEL=<provider>:<model>` then names the model, where the provider is `anthropic`, `openai` or `vercel-gateway`. A server on this computer or on your network needs no key. Amazon Bedrock and Google Vertex AI have no way of their own yet: reach them through LiteLLM. Claude on Microsoft Foundry is reached through its Messages API.

**Prices.** Footnote counts what each call costs against its spending limits. It knows the prices of the Claude models it lists. Any other model needs its price in US dollars per million tokens, input then output, such as `FOOTNOTE_MODEL_PRICES=0.1,0.5`. A model that costs nothing, such as one on this computer, has prices of `0,0`, and the service logs it at start-up.

**The judge.** The test runs' judge is another model of the same vendor when the provider lists one. The `openai` provider lists none, so its model judges its own answers. Name another judge with `FOOTNOTE_JUDGE_MODEL` and `FOOTNOTE_JUDGE_MODEL_PRICES`.

## The model check

Once it starts, the service makes three tiny calls on each role's model: a tool call, a call told to use no tool, and an answer in a set JSON shape. It costs a fraction of a cent, and sends no company data.

- A model that cannot call tools still answers Ask, without its tools, and the test runs refuse to start on it, saying why.
- A judge that cannot keep to a JSON shape is asked for plain JSON text instead.
- A check that cannot tell, because the provider failed or refused the key, changes nothing and runs again a few minutes later.

The log, and Settings, Advanced under Models, say what each check found. `docker compose exec footnote npm run models:check` makes it again, and `-- --model openai:gpt-oss:20b --prices 0,0` checks a model before you set it.

## Tested models

Each row is one run of Ask's evaluation harness on the demo: 156 cases, 128 open and 28 held back, each asked once. Code grades every promise, and Claude Haiku 5.5 judges every sentence a model wrote. Measured in November 2026.

| Model            | Reached through                    | Passes every check | Keeps every promise | Says what it must |
| ---------------- | ---------------------------------- | ------------------ | ------------------- | ----------------- |
| Claude Haiku 5.5 | the gateway's Chat Completions API | 28%                | 47%                 | 48%               |
| GPT-6 Luna       | `openai`, at the gateway's address | 30%                | 79%                 | 38%               |
| gpt-oss-120b     | the gateway's Chat Completions API | 16%                | 68%                 | 24%               |
| gpt-oss-20b      | `openai`, at the gateway's address | 16%                | 54%                 | 25%               |

The percentages are of the 128 open cases. One run moves by about five cases either way, so close rows are a tie.

- **The promises hold on every model.** Code checks that every number comes from a read and every citation opens. It kept 126 or more of the 128 cases to both on each model.
- **Usefulness is what changes.** Says what it must is the share of answers with the facts the case needs. The open models take a side where items disagree and state counts that are wrong, and gpt-oss-120b answers mostly from a search instead of the main read.
- **gpt-oss-20b is what `ollama run gpt-oss:20b` serves.** It is a fair stand-in for a laptop-sized model on this computer: it works, and its answers are among the least complete.

To measure another model, from a clone of the repository:

```sh
npm run eval:ask-harness -- --real --answerer loop --tries 1 --no-judge-set \
  --model openai:gpt-oss:20b --prices 0,0 --max-cost-usd 0.50
```

It costs USD 0.15 to 0.50 a model, and stops before it spends more than `--max-cost-usd`.

## Things to know

- **Claude keeps its prompt cache through a Messages API.** Through `ANTHROPIC_BASE_URL` it reads most of each question from the cache, which costs a tenth as much. Through a server that speaks OpenAI's API it does not, except through `vercel-gateway`, the Vercel AI Gateway's own way in.
- **Ollama ignores the tool choice.** Ask tells its model to use no tool on its last step. A model on Ollama may call one anyway, and Ask still ends the answer at its step limit.
- **Reasoning models are slower.** OpenAI's API has no way to turn reasoning off. A model that reasons on every step can reach Ask's time limit, `ask.time_limit_seconds`, which an admin can raise.

## What leaves this computer

For each question, Ask sends the chat so far, the text of the items it reads, their owners' names, and whether the person asking is an admin and which domains they own. It sends no e-mail address and not the asker's name. Test runs send their test questions and the items they read, and the judge receives the answer too.

| Option                                                     | Who receives it                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| `MODELS=mock`, the default                                 | No one                                                        |
| Anthropic's API                                            | Anthropic, under its API terms                                |
| Vercel AI Gateway                                          | Vercel, then the model's vendor                               |
| A gateway at `ANTHROPIC_BASE_URL` or `OPENAI_BASE_URL`     | The gateway's operator, then whoever it passes the request to |
| OpenAI's API                                               | OpenAI                                                        |
| LiteLLM, Portkey or a gateway on your company's network    | Your company's gateway, then the providers it is set up for   |
| Bedrock or Vertex AI through LiteLLM, or Microsoft Foundry | Your company's own cloud account                              |
| Ollama, vLLM or LM Studio on this computer or your network | No one outside: nothing leaves                                |

The notice before a real test run names who receives it, worked out from the address: this computer, your network, or the host at its address. Put no company data in until your company approves the provider.
