# Omaha Morning Brief

A five-minute spoken morning briefing, published as a web app in `docs/` (GitHub Pages, installable on iPhone).
Each episode lives in `docs/episodes/YYYY-MM-DD/`.

## Producing today's episode

1. **Research** with three parallel research agents: (a) markets and macroeconomics, (b) major company news,
   (c) world and geopolitical news that moves the economy. Tell each one: only facts from sources dated in the
   last few days, a source URL and date for every fact, say "not found" rather than guess, flag conflicts.
   WebFetch is often blocked here, so agents work from WebSearch (mode "extended").
   The Financial Modeling Prep connector is on a free plan: only `economics` → `treasury-rates` works.
2. **Verify** every headline claim with a second, independent search before it goes in. Drop anything you
   cannot confirm. When sources disagree, use the safer wording ("near-record", "about one in three").
3. **Write** `docs/episodes/YYYY-MM-DD/script.json` (copy the most recent episode's file as the template).
4. **Build**: `pip install -r requirements.txt` then `python3 build_episode.py docs/episodes/YYYY-MM-DD`.
   The first run downloads the voice model (about 350 MB) from GitHub releases into `models/`.
   Target length is 4:45 to 5:30. If it runs long or short, edit words and rebuild.
5. **Publish**: commit `docs/episodes/YYYY-MM-DD/` and `docs/episodes/index.json`, then push to the branch
   GitHub Pages serves. The app picks up the new episode on next open.

## Editorial rules (approved by the listener)

- The listener is addressed as "Warren". Open with "Good morning, Warren." and the date.
- About 650 to 690 words in six sections: The short version, Rates and inflation, Markets, Companies,
  The world, Next week. Close with "That is the briefing. Have a good day."
- **No Berkshire Hathaway-specific news.** Cover broad news on major companies instead.
- Plain, direct sentences. No filler, no clichés, no emotional language, no forecasts presented as facts.
- **Full names, not abbreviations** in the spoken text: Federal Reserve, gross domestic product,
  artificial intelligence, International Monetary Fund, International Energy Agency. Proper names such as
  S&P 500 or JPMorgan are fine.
- Favor what matters to a long-term business owner: interest rates and Treasury bill yields, inflation,
  credit quality, pricing power and margins, capital allocation (buybacks, dividends, acquisitions),
  valuation (forward price to earnings, earnings yield against the 10-year Treasury, stock market value to
  gross domestic product), oil and energy, insurance catastrophe losses. Keep daily index moves short.
- Numbers table: gains as `+1.08%`, declines in parentheses as `(0.88%)` with `"dir": "down"`.

## script.json fields

`title`, `dateline`, `summary` (one line shown in the app), `voice` (`af_heart`), `speed`, `pronounce`
(spelling hints for the voice, for example `"Dimon": "Dye-mun"`), `sections[]` (`heading`, `paragraphs[]`),
`numbers_note`, `numbers[]` (`label`, `value`, `change`, `dir`), `sources[]` (`title`, `url`).
The build turns `$`, `%` and thousands separators into spoken words; write numbers normally.

## App

`docs/index.html`, `docs/app.css`, `docs/app.js`, `docs/sw.js`, `docs/manifest.webmanifest`.
Listening progress, the listening log and saved sections are stored in the browser on each device
(`localStorage` key `omb.v1`). Test locally with any static server that supports range requests.
