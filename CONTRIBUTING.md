# Contributing to Atlas for Designers

Thank you for helping designers learn the domains behind the products they design. There are four ways to help, from a five-minute error report to a whole new domain.

> **Licensing:** there is no open licence yet; the code and content are all rights reserved (see [LICENSING.md](LICENSING.md)). Error reports and reviews are welcome now. Pull requests can be reviewed, but won't be merged until licences are chosen.

## 1. Report an error

Found something wrong, outdated or unclear? [Open an issue](../../issues/new/choose) with **Report an error**. Say which domain and lesson, what is wrong, and a source if you have one. Accuracy matters more than anything else here, so these reports are the most valuable contribution of all.

## 2. Review lessons as a domain expert

If you work in a domain, you can review its lessons for accuracy, emphasis and real-world examples. Use **Volunteer as a reviewer**. Reviewers are credited by name on the lessons they review.

## 3. Write or improve a lesson

1. Read the [authoring standard](docs/authoring.md). Every lesson has the same parts, and the build checks them.
2. Copy a lesson block from an existing domain as a starting point.
3. Write the content, its design block in `design/`, and add any new sources to `references.json` **after opening each one**.
4. Run `python3 scripts/build-domains.py <domain>` and fix every problem it lists.
5. Open a pull request using the template. Say whether you used AI, and ask for an expert review.

## 4. Propose a new domain

Use **Propose a domain** and describe the field, who it's for, the standard or syllabus it would follow (if any), and **who will maintain and review it**. A domain needs at least one committed expert reviewer before work starts, because a domain is only as good as its least accurate lesson.

## Rules every contribution follows

- **Original work only.** Never paste material from paid courses, books or other copyrighted sources. Explain ideas in your own words and cite free sources.
- **Every reference is opened and checked by a person** before it is added, with the date in `references.json`. Prefer primary sources: standards bodies, official documentation, regulators.
- **AI drafting is allowed, and must be disclosed.** Say so in the pull request. AI-assisted drafts are never merged without review by a domain expert, because a passing build proves a lesson is complete, not that it is correct.
- **Plain language.** Short sentences, every acronym defined the first time, one concrete example for each idea, and an explanation for every answer option, right or wrong.
- **No real company named as an example product** in the design layer. Use archetypes such as "a B2B SaaS product". The build rejects common company names there.
- **Honest labels.** If a concept has no real design application, say so; don't invent an exercise.

## Review and merging

- Content changes need approval from **a domain maintainer** (accuracy) and **the design editor** (design layer and quality bar). `CODEOWNERS` requests both automatically.
- The checks in `.github/workflows/checks.yml` must pass. They also confirm that `content/` was rebuilt, so commit the output of `scripts/build-domains.py` with your change.
- Large changes are easier to review in small pull requests: one to three lessons at a time.

## Working on the app

The app is plain HTML, CSS and JavaScript modules. Run `node scripts/serve-local.mjs` and open http://localhost:8095. Run the checks listed in the [README](README.md) before opening a pull request. Keep it dependency-free, accessible (WCAG 2.2 AA) and private by design: no tracking, and nothing leaves the device unless the learner turns on sync.

## Conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
