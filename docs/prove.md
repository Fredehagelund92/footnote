---
title: Run the proof
line: One command asks the same questions three ways and prints what each got right and what it cost.
group: How it works
order: 2
reviewed: 2026-11-25
---

There is no measured figure yet for how much better an agent answers with Footnote. The proof is how that gets measured, by anyone, on the invented company or on your own context. One command asks the same questions about a period and a market three ways, through the same agent, and prints a table of what each way got right.

## The three ways

| Way            | What the agent has                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No context     | The question, and nothing else.                                                                                                                                                                               |
| One plain file | Every published note as one Markdown file it has read, as a coding agent reads a notes file in your repository: each title, what it is about, when it applies, the text, what not to conclude and the source. |
| Footnote       | Footnote's tools over MCP, with the instructions every connected agent gets.                                                                                                                                  |

Everything else is the same: the model, the prompt, the day the question is asked on, and the judge. Each question is asked three times each way, so the table shows how much an answer changes from one try to the next.

The judge is a model that reads each answer, never the tools behind it, so every way is graded alike. For each note a question names, it says whether the answer tells it. For a question where nothing is written, it says whether the answer says so.

## Run it

Run it where Footnote runs, on its database. Without `--real` a scripted model answers: nothing leaves the computer, nothing is spent, and the table shows only that the command works.

```sh
npm run footnote -- prove --questions my-questions.yaml                   # scripted model, free
npm run footnote -- prove --questions my-questions.yaml --real --cap 5    # a real agent, at most USD 5
npm run footnote -- prove --questions my-questions.yaml --tries 1         # one try each, for a first look
```

A real run uses the answering model and the judge of the [test runs' model settings](model-providers.md), with the provider's key in `.env.local`. Before any call it prints:

- how many questions it asks, how many ways and tries, and how many answers that makes;
- how many notes agents are told, and the size of the plain file;
- the estimated cost, your cap, and who receives the questions and the published notes.

Then it waits for a yes. It refuses a cap below the estimate, and no answer starts once the cap could be passed. Ctrl+C stops it after the answers in flight.

The plain file holds every published note, so on a large workspace it can be longer than the model can read at once. The invented company's file is about 176,000 tokens. When the file is too long, that way's answers fail, and the run says how many answers were not made.

## Read the table

```
                 Right reason,      Told a note that had     Said nothing is
                 no wrong one       ended or was elsewhere   written when true
No context       .. of 40 (..)      -                        .. of 10 (..)
One plain file   .. of 40 (..)      .. of 40 (..)            .. of 10 (..)
Footnote         .. of 40 (..)      .. of 40 (..)            .. of 10 (..)

Model: <the answering model>, judged by <the judge>. Items: ... Questions: ... Spent: USD ..
```

- **Right reason, no wrong one** counts the answers that told every note that gives the reason, and no wrong note. For a question where nothing is written, it counts the answers that said so and told no wrong note.
- **Told a note that had ended or was elsewhere** counts the answers that told a note the question marks wrong: one that ended before the period asked about, or one about another market. With no context there is no note to tell, so it shows a dash.
- **Said nothing is written when true** counts, of the questions where nothing is written, the answers that said so.

Each count is the middle try, out of the number of questions, with every try in brackets: `31 of 40 (29, 31, 33)`. Forty questions is a small set, so a difference between two ways means little unless it is bigger than the spread of their tries.

Under the table are the model and the judge, whose items and questions they were, and what the run spent. A run that stopped early says how many answers were not made. An answer the model refused, or the judge could not grade, is counted in no column, and the command says how many there were.

## Write your own questions

Copy the [question template](templates/prove-questions.yaml). Each question has an id, the day it is asked on, the question as a person asks it, the notes that give the right reason, and the notes an answer must not tell. A question that names no right reason is one where nothing is written.

- Ask about periods and markets where you know the answer.
- Mix the kinds: a note that fits, one that had ended, one about another market, and about a quarter where nothing is written.
- Write them before your first run and keep them as they are. A question changed until one way wins proves nothing.

The command checks the file first, and refuses a question that names a note agents are not told. A question is never a real one someone asked: no names, figures or partner details.

## The invented company's questions

The result at the top of the README will be the invented company's, whatever it shows. Its 40 questions are sealed until the first funded run, so nobody who builds Footnote can tune it to them. Until then only their key holder can run that proof, with `npm run held-out -- prove`, and it prints the same table and nothing of a question.

After that run the questions are published with the result. From then on, `npm run footnote -- prove` with no file asks those same 40 questions on the demo. The digest it prints next to the questions is the one under the README's table, so you can check it is the same set.

## What it keeps and sends

The run is kept as one record of its model calls, what they cost and the table's counts: no question, answer or note. A real run sends the questions and the published notes to the model provider you chose, and to no one else.
