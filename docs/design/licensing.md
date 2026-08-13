# Licensing

> 2026-08-13 · Status: **RESOLVED - owner chose AGPL-3.0-only.** /LICENSE carries the full text; every package.json declares `AGPL-3.0-only`; README's License section states all four surfaces. The analysis below is kept for the record.

## The project has four licensing surfaces

| Surface                                                           | What applies                         | Status                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The code** (this repo)                                          | One SPDX license in /LICENSE         | **Owner decision needed - recommendation below**                                                                                                                                                                                        |
| **Bundled fonts**                                                 | SIL OFL 1.1, per face                | Handled: OFL permits app bundling; each face's license text ships in the fonts directory (M4 foundations includes LICENSES.md)                                                                                                          |
| **Bundled sounds**                                                | CC0 only (by policy - boundary 2.10) | Handled: CC0 requires nothing; we keep a credits/audit row per file anyway (media checklist §5)                                                                                                                                         |
| **User-created content** (boards, packs, themes made in the tool) | The creator's, full stop             | Handled by design: exports carry an optional `license` metadata field the creator controls; the app claims nothing. Event media follows the per-file rules in docs/content/media-and-sounds.md (PD preferred, CC BY-SA = credits slide) |

## Code license recommendation: AGPL-3.0-only

The project exists because the alternatives are paywalled. The license should protect that story. **AGPL-3.0** is the fit:

- **Anyone can self-host, modify, and share it free** - the promise stays intact.
- **The SaaS-capture loophole is closed**: if someone takes the code, improves it, and offers it as a hosted service (exactly what a JeopardyLabs-competitor would do), the AGPL's network clause obliges them to publish their modifications. Plain GPL does not cover network use; MIT/Apache invite proprietary re-hosting outright.
- Common, well-understood choice for exactly this shape of project (self-hosted web apps guarding against closed SaaS forks: Cal.com core, Plausible, Grafana).
- Cost honestly stated: AGPL scares off some corporate contributors and embedders. For a personal/community tool that is a feature, not a bug - and the owner (sole copyright holder while contributions are theirs) can always dual-license or relicense later if every contributor agrees (trivial while it's one person).

**Alternative if maximum adoption ever outranks anti-capture:** MIT. One file swap while the contributor count is 1. The wrong choice is having no file.

## Mechanics when the owner confirms

1. Add `/LICENSE` (full AGPL-3.0 text) + `"license": "AGPL-3.0-only"` in every package.json.
2. README gets a licensing section: code AGPL, fonts OFL, sounds CC0, your-content-is-yours.
3. No CLA needed at this scale; if outside contributions ever matter, revisit (DCO sign-off is the lightweight option).
