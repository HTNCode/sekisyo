# Sekisyo CLI — Understand First, Then Review.

> We do not reject AI-written code. We reject code without an explanation.

- Sekisyo CLI is not a tool for banning AI-generated code. It is a CLI built
  around Git's `pre-push` hook that guides developers to a point where they can
  explain the changes and design decisions themselves before sending their code
  for review.

## Inspiration

- As AI-driven development has become more common in day-to-day software
  development, developers have become dramatically faster at writing code. Our
  ability as humans to understand, evaluate, and review code, however, has not
  increased at the same pace.
- In real-world development, I was seeing more cases where developers submitted
  AI-generated code for review without fully understanding its implementation or
  design decisions. In that situation, reviewers have to infer from the diff not
  only whether the code is correct, but also why the change was made, which edge
  cases were considered, and how existing functionality may be affected.
- AI may accelerate implementation, but it does not increase the time and
  attention available for review. As a result, human review bandwidth becomes
  the new bottleneck.
- This is not only a short-term review-effort problem. If developers have fewer
  opportunities to read code and put design decisions into words, team knowledge
  and talent development also suffer over the medium to long term. When the
  “responsibility to understand” keeps shifting from developers to reviewers,
  organizations that adopted AI to make development more efficient incur a new
  kind of debt.
- Many existing AI review services automatically add comments to pull requests
  or otherwise assist reviewers. What I wanted, however, was an educational
  mechanism further upstream—one that encourages understanding and learning on
  the part of the person who wrote the code.
- At the same time, I was uncomfortable with approaches that detect and ban
  AI-generated code. The answer is not to return to development without AI, but
  to improve how we use it without abandoning the premise that AI is part of the
  workflow.
- That led me to create Sekisyo CLI around the idea of pausing once at a
  “checkpoint” just before review, without significantly changing the existing
  development workflow.

## Features

- Sekisyo CLI runs as a Git `pre-push` hook. When a developer runs `git push` as
  usual, it performs the following steps before sending the code to the remote
  repository.

1. **Understand the diff and focus attention** Codex analyzes the changed areas
   and their scope of impact in the context of the entire repository. At the
   same time, it creates an attention map that classifies the diff as
   “mechanical,” “routine,” or “must-read,” along with findings the developer
   should review before pushing.

2. **Perform an initial self-review** For each Codex finding, the developer
   either chooses to “stop and fix it” or explains why they are accepting it as
   an “intentional change.” Those reasons are later preserved in the pull
   request body.

3. **Question the developer** GPT-5.6 generates questions that are difficult to
   answer without genuinely understanding the changes.

4. **Probe vague explanations** An answer such as “It is probably fine” triggers
   follow-up questions about the relevant code and design decisions.

5. **Push once the changes can be explained** Once the answers become specific,
   the passed state and Q&A are temporarily stored and bound to the HEAD SHA,
   base, destination ref, question policy, and model, and the push proceeds. The
   Q&A summary is not generated during push; `sekisyo pr` generates it only
   after selecting an exact matching passed record.

6. **Give reviewers the context they need to make decisions** `sekisyo pr`
   creates or updates a managed block in the pull request body containing the
   attention map, design decisions, acknowledged risks, validation performed,
   unresolved issues, reasons from the initial self-review, and passed Q&A. The
   local pass is deleted once this write succeeds.

The questions do not merely ask developers to summarize code. To that end,
Sekisyo CLI defines and uses the following taxonomy of “questions that are
difficult to answer without understanding.”

| Question type            | What it checks                                                              |
| ------------------------ | --------------------------------------------------------------------------- |
| Edge cases               | How the code behaves with an empty input, a maximum value, or similar cases |
| Impact on unchanged code | What effects propagate to unchanged callers or existing functionality       |
| Rejected alternatives    | Why the existing implementation or another design was not chosen            |
| Failure behavior         | What state remains after a timeout or a partial failure                     |

```text
$ git push

Q. Who invalidates the cache on the old path now that this change no longer calls invalidate?

> It is probably fine

That answer does not establish the scope of impact. Explain the relevant callers and when invalidation occurs.
```

- Answers to the questions do not have to be written entirely by a human.
  Developers may consult AI as they formulate their answers.
- To have AI produce a substantive explanation, the developer must read the
  diff, provide the necessary information, and verify the generated explanation.
  If that process deepens their understanding of the code, it is also a form of
  learning that Sekisyo CLI aims to foster.
- The criterion is not whether an answer “looks human-written,” but whether it
  gives a specific, verifiable explanation of the change.

## How I Built It

### Placing it at a natural Git boundary

- I chose Git's `pre-push` hook so that Sekisyo CLI intervenes immediately
  before code is sent to a remote, rather than after a review request has
  already been opened.
- This means there is no need to wait for GitHub Actions, and the checkpoint
  itself does not depend on any particular hosting service: it works with
  GitHub, GitLab, or a self-hosted Git service. Only the pull request body
  update performed by `sekisyo pr` uses GitHub CLI in the current MVP.
- Pushing from an IDE or AI agent also triggers the hook. However, a push
  without access to an interactive terminal fails safely and instructs the
  developer to complete `sekisyo ask` in a terminal first.

### Analyzing the entire repository with Codex

- Sekisyo CLI runs Codex CLI in headless mode and analyzes the diff in the
  context of the entire repository, including callers and related files, rather
  than looking only at the changed lines.
- A summary of the changed code is not enough to produce good questions. It was
  essential to identify how the change could propagate to code that was not
  modified.

### Generating questions and evaluating answers with GPT-5.6

- Based on Codex's analysis, GPT-5.6 generates questions that follow the
  question taxonomy. It also evaluates whether the developer's answers contain
  specifics such as the relevant code, failure conditions, and design decisions,
  and asks follow-up questions when necessary.
- At the heart of Sekisyo CLI is not “AI that provides answers,” but **AI that
  asks good questions to elicit understanding**.

### Using no server or database

- Clearance status and Q&A are temporarily stored in `.git/sekisyo/`, tied to
  clearance conditions such as the HEAD SHA. Keeping them outside the worktree
  also prevents them from being committed accidentally.
- I considered using `git notes` for permanent storage, but decided against it
  because it requires additional push configuration, has compatibility issues
  with rebases and squash merges, and is difficult to see in the GitHub UI.

| Component                | Technology          | Role                                                                           |
| ------------------------ | ------------------- | ------------------------------------------------------------------------------ |
| CLI                      | TypeScript + Bun    | A fast-starting CLI that is easy to distribute                                 |
| Execution point          | Git `pre-push` hook | A checkpoint immediately before the code reaches review                        |
| Diff analysis            | Codex CLI           | Analysis that includes the context of the entire repository                    |
| Questions and evaluation | GPT-5.6 API         | Question generation, answer evaluation, follow-up questions, and Q&A summaries |
| Temporary records        | `.git/sekisyo/`     | Local state management with no server required                                 |
| Pull request integration | GitHub CLI          | Adds the attention map and explanation record to the pull request body         |

## Challenges I Faced

### Distinguishing good questions from mere summary questions

- If a model is simply asked to generate questions, it tends to produce
  questions such as, “What does this function do?” that can be answered by
  merely reading the code aloud. Those questions do not reveal whether the
  developer understands the risks of the change or the design decisions behind
  it.
- I therefore broke questions down into edge cases, scope of impact,
  alternatives, and failure behavior, and made those categories an explicit
  question taxonomy. Instead of treating this only as a prompting technique, I
  designed “what should be asked” as part of the product specification itself.

### Designing the boundary between education and surveillance

- If designed poorly, a checkpoint can turn into a tool for monitoring
  developers and policing their use of AI.
- Sekisyo CLI does not detect whether AI was used. It also allows developers to
  use AI when answering the questions, and permits bypassing the checkpoint with
  `git push --no-verify`.
- The purpose is not to police people, but to give developers a tool that helps
  them meet their responsibility to explain their work and deepen their
  understanding.
- It preserves operational flexibility so that each organization can choose how
  to use it according to its own stage of growth.

### Balancing the value of pausing with development speed

- If there are too many questions, Sekisyo CLI itself becomes a new bottleneck.
  If they are too easy, the checkpoint serves no purpose.
- Rather than questioning every change to the same depth, the system needed to
  focus questions on high-risk areas and places that require human judgment. The
  emphasis was not on replacing review, but on helping developers organize their
  understanding and focus their attention before review.

### Separating temporary records from permanent records

- Permanently retaining pass records would create management overhead with every
  rebase or squash merge. Design decisions, on the other hand, are worth
  preserving as team knowledge.
- I therefore designed a lifecycle in which the local pass is disposable, while
  passed Q&A, design decisions, risks, validation performed, unresolved issues,
  and the attention map—information worth retaining—are transferred to the pull
  request body.

## Accomplishments That I Am Proud Of

- What I am most proud of is fitting the entire experience—diff analysis, an
  oral examination, deeper probing of answers, and resuming the push—inside the
  `git push` command developers already use. Without introducing a new
  management interface or a complex server, I created a “checkpoint for
  understanding” that does not disrupt the existing development workflow.
- I am also proud that the product consistently adheres to the principle of
  **evaluating only the specificity of the explanation**, rather than detecting
  or banning AI-generated code. It even allows developers to answer with AI
  while still encouraging their understanding and accountability.
- I also avoided leaving question quality entirely to the model by turning “edge
  cases,” “impact on unchanged code,” “rejected alternatives,” and “failure
  behavior” into a taxonomy that can be shared publicly. Converting good
  questions into a reproducible product specification is, I believe, a unique
  value that Sekisyo CLI offers.
- I am proud to have brought three kinds of value together in one small CLI:
  learning for developers, decision-ready information for reviewers, and a
  record of design decisions for the team.

## What I Learned

- My biggest lesson was that the bottleneck in AI-driven development is shifting
  from code generation to the **handoff of understanding**.
- The faster AI can write code, the more valuable information becomes about why
  a change was made and under what conditions it could break. Reducing review
  burden and organizational learning debt requires not only making reviews
  faster and more accurate, but also improving the quality of that information
  upstream, before it reaches reviewers.
- I also learned that AI can be used not only to generate answers, but also to
  create questions that deepen human understanding. By putting question quality
  at the center of the product, AI can serve not only as a substitute for work,
  but also as a partner in learning.
- Accountability can also be strengthened without banning AI. By allowing
  developers to answer with AI and evaluating the specificity of the answer
  rather than its provenance, AI adoption and talent development do not have to
  become opposing goals.

## Where Sekisyo CLI Is Today and Where It Is Going

- The MVP implements the `pre-push` hook, diff analysis with Codex, an initial
  self-review, oral examination and answer evaluation with GPT-5.6, the
  attention map, temporary local records, write-back to the pull request body,
  customization of the question taxonomy through `.sekisyo.yml`, and a
  verification CI job that checks the records in the pull request body.
- In the future, I want Sekisyo CLI to become more than a pre-push checking
  tool: I want it to help each team develop its own standard for “what we should
  understand and be able to explain.”
- The goal remains to actively encourage the use of AI while ensuring that
  developers understand the code AI writes, reviewers have the information they
  need to make decisions, and the resulting knowledge can be retained by the
  team.
- For that reason, we would like to explore ways to increase the flexibility of
  the model’s use and pursue more flexible customization options, if possible.
