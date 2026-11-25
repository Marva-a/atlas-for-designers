# Domain-pack authoring standard

This is the format every domain follows. The build script, `scripts/build-domains.py`, enforces the structure; reviewers check the facts. The [example domain](../domains/authoring/) uses every part described here, and the [Security domain](../domains/security/) is a complete, real example.

## 1. The files in a domain pack

```
domains/<id>/
  domain.json        title, status, areas, objectives, modules, weeks and session order
  references.json    every source, with URL, cost and the date it was last opened
  *.txt              lessons, questions, labs and (optionally) practice exams
  design/*.txt       the design layer for every lesson, and case studies
  diagrams.json      optional: diagrams lessons refer to with "diagram: key"
  visuals.json       optional: extra visuals shown with lessons
  local/             private audit material; never committed (git-ignored)
```

`<id>` is lowercase letters, numbers and hyphens, such as `healthcare` or `ai-products`.

## 2. domain.json

| Field | Required | Meaning |
|---|---|---|
| `id` | Yes | Same as the folder name |
| `title`, `short` | Yes, `short` optional | Full name, and a short name for labels (for example "Security+") |
| `tagline`, `audience` | Yes | One sentence each, shown on the home page |
| `status` | Yes | `complete`, `beta`, `draft` or `example` |
| `maintainers` | Recommended | GitHub usernames of the people accountable for accuracy |
| `notices` | Optional | Important caveats shown on the domain's overview, such as trademark or AI notices |
| `about` | Optional | Paragraphs describing the domain or its standard |
| `areas` | Yes | Broad parts of the field: `{ "1": { "name": "...", "weight": 20 } }`. Weights are optional |
| `objectives` | Yes | Specific things learners should be able to do: `[{ "id": "1.1", "short": "..." }]`. The part before the dot is the area |
| `objectiveLabel` | Optional | What objectives are called, such as "Objective" or "Goal" |
| `weeks` | Yes | Each week: `n`, `phase` (`foundation` or `domain`), `title`, `outcome` and `sessions` in order |
| `modules` | Yes | Groups of weeks, each with `security` (domain knowledge) and `design` (design application) descriptions |
| `sections` | Yes | Which pages the domain shows, such as curriculum, design practice, labs, knowledge checks, exams and library |
| `exam`, `examBlueprint`, `examLabel` | Only for exam-aligned domains | Exam facts, and the number of practice-exam questions per area |
| `sheets` | Optional | Revision sheets built from tables already in lessons |
| `officialOrg`, `referencesChecked` | Optional | An organisation whose material is listed separately, and when references were last checked |

A session is `{"type": "lesson", "id": "..."}`, or a review such as `{"type": "review", "title": "...", "min": 30, "link": "quiz/week-3"}`. Links are relative to the domain.

## 3. A lesson

A lesson starts with `@lesson <id>` and has one key per line. A blank line or a line starting with `#` is ignored.

| Key | Required | Notes |
|---|---|---|
| `title:`, `level:`, `min:`, `why:` | Yes | Level is Beginner, Intermediate or Advanced; minutes exclude the design exercise |
| `obj:` | Yes | Objective ids, comma-separated, or `none` for foundations |
| `pre:` | Yes | Earlier lesson ids, or `none`. Must come earlier in the order |
| `domain:` | Recommended | The area name, shown on the lesson |
| `out:` | At least 2 | "By the end, you can..." outcomes |
| `plain:` | At least 1 | Plain language, ideally with an everyday analogy |
| `tech:` | At least 1 | The precise explanation |
| `term: Word == meaning` | At least 3 | Key terms |
| `eg:` | At least 1 | Concrete examples from real work |
| `walk: Title`, then `- step` lines | At least 1 | A walkthrough |
| `lab: Title \| minutes \| tool`, then `do:`, `expect:`, `explain:`, `pass:` | At least 1 | Safe, legal and free: only your own systems or authorised practice environments |
| `scenario:` and `answer:` | Yes | A realistic situation and a model answer |
| `q ...` | At least 3 | Questions; see below |
| `mistake:` | At least 1 | Common mistakes |
| `sum:` | At least 1 | Summary points |
| `card: front == back` | At least 1 | Flashcards |
| `ref: <id> r` or `ref: <id> s` | At least 1 required | Required or supplementary sources from `references.json` |
| `table: Caption \| col \| col`, then `\| a \| b` rows | Recommended | Especially for commonly confused pairs |
| `diagram: key` | Optional | A diagram from `diagrams.json` |

## 4. Questions

```
q 2.3 mcq e | Concept | The question?
> optional log or config line shown above the options
+ Right option :: why it is right
- Wrong option :: why it is wrong
```

- Kinds: `mcq` (four options, one right), `tf` (True and False), `multi` (four or more options, two or more right, at least one wrong), `order` (numbered steps `1. ...`, at least three, plus `why:`), `match` (`= left => right` rows, at least three with unique answers, plus `why:`).
- Difficulty: `e`, `m` or `h`.
- Every option explains why it is right or wrong. That is where most of the learning happens.
- Questions must be original. Never copy real exam questions.

## 5. The design layer

One block per lesson in `design/*.txt`:

```
@d <lesson-id> direct|professional|foundation
sector: The kind of product, such as B2B SaaS
product: How the concept shows up in real products (one or more lines)
```

- **direct** lessons have a full exercise: `ex: Title | minutes`, then `scenario:`, `problem:`, at least two each of `task:`, `constraint:`, `need:` and `senior:`, a `deliver:` line, criteria for all four of `crit constraints:`, `crit risk:`, `crit quality:` and `crit senior:`, and at least one critique question `cq m | Concept | Question` with `+`/`-` options. They also need `ask eng:`, `ask sec:` and `ask prod:` questions.
- **professional** lessons have `ask eng:`, `ask sec:`, `ask prod:` and a `noex:` line explaining why there is no exercise.
- **foundation** lessons have a `noex:` line.
- Use archetypes, never real company names, for example products.

Case studies use `@case <id>` with `title:`, `week:`, `min:`, `obj:`, `lessons:`, `practice: Text | link`, and the same exercise parts.

## 6. References

Each entry in `references.json`: `id`, `title`, `org`, `url`, `type`, `minutes`, `free` (must be `true`), `access` (how to read it), and `verified` (the date a person last opened it). Never add a link nobody has opened.

## 7. Review checklist

Reviewers check, for each lesson:

- [ ] **Accuracy:** every statement is correct and current, and matches the cited sources.
- [ ] **Emphasis:** the lesson stresses what matters in real work, not trivia.
- [ ] **Examples:** at least one example rings true to someone who works in the field.
- [ ] **Questions:** one clearly right answer, plausible wrong answers, and accurate explanations.
- [ ] **Labs:** safe, legal, free, and they work as written.
- [ ] **Design layer:** the relevance label is honest, and an exercise (if any) reflects a real design problem.
- [ ] **References:** sources are primary where possible, free, and actually support the text.
- [ ] **Language:** plain, inclusive and accessible; acronyms defined.

When a lesson passes review, the reviewer approves the pull request and is credited.
