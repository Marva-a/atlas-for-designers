# Atlas for Designers

**Learn the domain behind the product.** Free lessons that pair real domain knowledge with product design practice: concepts, hands-on labs, design exercises and portfolio case studies.

Designers who move into a specialised field (security, healthcare, fintech, AI products and others) are often told the same thing: great designer, but doesn't know our domain yet. Atlas for Designers closes that gap. Each domain teaches the field properly, and every lesson connects it back to product design work.

## Domains

| Domain | Status | What it covers |
|---|---|---|
| [Security for Product Designers](domains/security/) | Complete | 60 lessons over 16 weeks, to the CompTIA Security+ (SY0-801) standard, with design exercises, three case studies and practice exams |
| [How to write an Atlas domain](domains/authoring/) | Example | Two short lessons that teach the domain-pack format by using it |

Want to help? Read [CONTRIBUTING.md](CONTRIBUTING.md).

## How every lesson works

1. **Learn the concept**: what it is, why it exists and what problem it solves, in plain language.
2. **Technical deep dive**: the mechanisms and terms people in the field use, with a hands-on lab.
3. **See it in real products**: how the concept shapes the products designers work on.
4. **Apply it as a product designer**: where it has a real design application, a full exercise with a brief, constraints and criteria.
5. **Test your understanding**: a knowledge check and, separately, a design assessment.
6. **Review and references**: common mistakes, a summary, free references and flashcards.

Knowledge and design competency are measured separately and never combined.

## Private by design

- **No accounts and no tracking.** Your progress is saved in your own browser.
- **Optional sync between your devices.** Choose **Show a code** on one device and type the 8 digits on the other. Your progress is encrypted on your device before it is uploaded, so the sync service can't read it. See [sync-worker/README.md](sync-worker/README.md).
- **Works offline**, and can be installed like an app.
- **Back up and restore** your data as a file at any time.

## Run it on your computer

Plain HTML, CSS and JavaScript modules: no frameworks, no dependencies, no build step for the app itself.

```bash
python3 scripts/build-domains.py     # turns domains/*/ into content/domains/*/
node scripts/serve-local.mjs         # then open http://localhost:8095
```

## Checks

```bash
python3 scripts/build-domains.py          # refuses any lesson that is incomplete or malformed
node js/cert-selftest.js                  # scoring rules, and every answer key in every domain
node js/sync-selftest.js                  # sync merging, encryption and code pairing
node --no-warnings sync-worker/test.mjs   # the sync service
```

The same checks run on every pull request.

## Licence

**No open licence yet.** Copyright (c) 2026 Marva Abouei: until licences are chosen, the code and lesson content are all rights reserved. You're welcome to read and learn from them and to report errors; pull requests can be reviewed but not merged yet. See [LICENSING.md](LICENSING.md), which also lists the built-in third-party parts and their own licences.

The Security domain is independent and is not affiliated with or endorsed by CompTIA. Security+ is a trademark of CompTIA.

## Origin

Atlas for Designers grew out of [Atlas](https://github.com/Marva-a/atlas), a personal course built by Marva Abouei, product designer, to move into security product design. This repository generalises it so any domain can be added.
