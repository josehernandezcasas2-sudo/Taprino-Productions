# Studio Tapa TV — "Not for AI training": proposed Terms language

**Draft for counsel · prepared 2026-10-25 · live in the Terms as a template, not yet reviewed.** Jose's decision the same day: the site's position is that nothing on it is licensed for AI training or text-and-data mining; creators can show or hide a visible "Not for AI training" seal on their work (on by default), and the policy applies whether or not the seal shows. The public page is `/ai-policy`; the Terms carry two additions, below, written into `pages/terms.js` sections 5 and 6 on 2026-10-25 next to the other clauses still waiting on review.

## What the site already does (so the clauses describe something real)

- `robots.txt` names every known AI training crawler and AI answer engine and turns them away; every response carries `X-Robots-Tag: noai, noimageai`, `TDM-Reservation: 1`, `TDM-Policy: https://www.studiotapatv.site/ai-policy` and `Content-Usage: train-ai=n, ai-use=n`; `/.well-known/tdmrep.json` repeats the reservation. These are the machine-readable signals the clause in section 6 refers to.
- Video plays only through short-lived signed links; captions, course files and location paperwork live in private storage behind the same checks as the video; catalogue and people reads are rate-limited; the API answers only the site's own origins; the app blocks screenshots and recording during playback.
- Honest scope, stated on the policy page: the signals are requests that the large AI companies document honouring and not everyone does; nothing stops a camera pointed at a screen; a trained model cannot be made to forget.

## Addition to section 5 ("If you submit work"), new heading `#ai`

> **Your work is not for AI training.** The licence you give us is for running and promoting Studio Tapa TV, as described above. We will not license your work to anyone for training, fine-tuning or evaluating machine-learning or artificial-intelligence models, or for text-and-data mining, and we don't train models on it ourselves. If that ever changed, it would need your separate written agreement first, for that use and that work.
>
> You can show or hide the "Not for AI training" seal on your titles and profile from your account. The policy applies either way. Our AI policy says what we do to keep the work off training sets and what we can't promise.

## Addition to section 6 ("What you may not do"), replacing the old "scrape the site" bullet

> - Collect anything from the platform by automated means, including crawlers, scrapers, bots, headless browsers, downloaders and screen recorders, or hit it with automated traffic that degrades it for others
> - Use anything on the platform, or anything derived from it, to train, fine-tune, evaluate, ground or prompt a machine-learning or artificial-intelligence model, or for text-and-data mining, whether or not for commercial purposes. We expressly reserve our rights under Article 4(3) of Directive (EU) 2019/790 and signal that reservation in machine-readable form on every page. Permission for a search engine to index the public pages does not include any of the above.

## Questions for counsel

1. **The EU citation.** The reservation under Article 4(3) of Directive (EU) 2019/790 is cited because the headers already signal it in the form that directive's ecosystem (TDMRep) expects, and because EU-based AI developers are bound to honour it under the AI Act's transparency obligations. Does naming it in a California company's terms help, or should the Terms say "all rights reserved, including text-and-data mining rights" and leave the article to the headers?
2. **Breadth of "evaluate, ground or prompt".** It is broad on purpose, to cover retrieval-augmented and "answer engine" uses, not only training. Does it reach an ordinary viewer who pastes a synopsis into a chatbot, and is that the intended reach? If not, a carve-out for personal, non-commercial use by a human viewer would narrow it.
3. **Browse-wrap enforceability.** Crawlers never click "I agree". The clause's value against a crawler operator is in the record of notice (robots rules, headers, the policy page, the seal), which recent US cases treat as relevant to whether automated access was authorised. Anything the page or the Terms should say to strengthen that record?
4. **The creator promise.** "We will not license your work … without your separate written agreement" is a promise to creators, not only a restriction on visitors. Confirm it does not conflict with the marketing licence in section 5 (thumbnails, trailers, social posts), which can involve third-party platforms that run their own models on uploaded media.

## What this draft does not do

- It does not create a per-creator opt-in to AI licensing. Jose decided (2026-10-25) that the policy applies to everyone; a licensing opt-in, if it is ever wanted, is a later decision with its own paperwork.
- It does not claim the measures are complete. The policy page says what cannot be promised in plain words, and the Terms should not say more than the page does.
