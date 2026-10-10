# Data, test tracks, blind test and research

## 1. Datasets: one job each

Figures marked **checked** were confirmed on the dataset's own page on 2026-10-10; others are unverified and must be checked before use.

| Dataset | Job | Notes |
| --- | --- | --- |
| MTG-Jamendo (https://github.com/MTG/mtg-jamendo-dataset) | Prototype corpus of varied full-length tracks (M2), bundled samples (M7) | Unchecked: 55,000+ tracks with genre, instrument and mood tags; Creative Commons licenses per track. Use a small subset; never download the full audio. |
| DEAM (https://cvml.unige.ch/databases/DEAM/) | Train/validate the emotion model (M10) | Checked: 1,802 excerpts and full songs, per-second valence and arousal, Creative Commons audio (1.3 GB), openSMILE features. Clips mostly short (about 45 s, from memory), so not used for structure. |
| PMEmo (https://github.com/HuiZhangDB/PMEmo) | Independent emotion validation (M10) | Unchecked: 794 songs, labels every 0.5 s, chorus excerpts only (copyright). |
| SiTunes (https://github.com/JiayuLi-997/SiTunes_dataset) | Optional preference sanity check | Unchecked: 30 participants, 307 tracks, 2,006 logs; too small for general claims; audio availability unknown. |
| HSP-S / HSP-L (https://zenodo.org/records/5383858) | Later, exploratory commercial-success baseline | Checked: AcousticBrainz features, Last.fm counts, Billboard for half of HSP-S, CC BY 4.0. Files are features, not audio, so signatures cannot be built from them. |

## 2. Prototype corpus: `data/manifests/prototype_30.csv`

Created in M2 (before downloading, show the list to the user).

- 30 tracks from MTG-Jamendo, 5 genre groups × 6 tracks: ambient/classical, rock/metal, electronic/dance, hip-hop/R&B, folk/acoustic/jazz.
- Selection: deterministic. Filter the metadata to tracks 120-420 s long with a single top-level genre tag in the group; sort by track ID; take the first 6 per group whose license allows redistribution of renders with attribution (CC BY, CC BY-SA; avoid ND/NC for anything shown publicly).
- Columns: `track_id, title, artist, genre_group, duration_s, license, license_url, source_url, sha256`.
- Audio stored in `data/audio/prototype_30/` (git-ignored); only the manifest is committed.
- Attribution for any render shown publicly: "Title — Artist (License)".

Bundled samples for the app (M7): 3 tracks from this manifest with CC BY or CC BY-SA licenses, contrasting in character.

## 3. Licensing rules

- Never commit audio. Never redistribute audio except bundled CC samples with attribution.
- User uploads: analyzed then deleted by default (`api.keep_audio: false`); only derived features are stored.
- Renders of commercial songs are the user's own artwork; the app does not host or share them publicly in the MVP.
- Record dataset licenses and citation requirements in this file when downloading.

## 4. Blind test protocol (M5)

- **Question:** can people match a song to its signature better than chance?
- **Participants:** ≥ 10 adults, informal recruitment by the user; verbal or written consent; no personal data beyond an optional age band and "music training: none / some / a lot".
- **Stimuli:** 12 songs from the corpus (2-3 per genre group). Each trial: a 20 s clip from the song's middle (start at 40% of duration) and 4 signatures (1 correct, 3 foils from other songs; half the trials use a same-genre foil).
- **Procedure:** static HTML page, one participant per session, about 10 minutes; trial order and foils determined by a participant seed; no feedback until the end.
- **Analysis:** per-participant accuracy; overall accuracy with a 95% confidence interval; one-sided binomial test vs 0.25; accuracy on same-genre-foil trials separately (harder and more informative); per-song accuracy to find weak mappings.
- **Gate:** ≥ 50% mean accuracy and p < 0.05. Report same-genre-foil accuracy regardless.

## 5. Research question and hypotheses (M11)

Question: does a structured, color-coded representation of musical characteristics reveal patterns in listener preference that conventional representations do not capture as well?

Honest hypotheses (to test, not assume):
- **H1:** fingerprint-based preference prediction reaches at least 90% of the performance of standard feature baselines.
- **H2:** listeners find signature-based similarity explanations more understandable than baseline explanations (interpretability study).
- **H3 (exploratory):** some fingerprint blocks (e.g. dynamics, rhythm) carry preference information beyond timbre.

## 6. Research plan (M11)

**Preference pilot**
- 30-50 participants, 40 tracks from the corpus (balanced across genre groups), 30 s clips, liking rated 1-7, plus familiarity (yes/no).
- Collected in the app (M9 rating feature) or a dedicated page; anonymous listener IDs.

**Models and baselines** (same splits, same model family)
- Representations: (a) SYNESTHESIA fingerprint (133), (b) per-map summaries, (c) MFCC mean/std + standard librosa features, (d) mel-spectrogram embedding (log-mel mean/std per band; optionally a pretrained audio embedding as an upper reference).
- Tasks: per-listener liking prediction (ridge or logistic regression on ratings ≥ 5), evaluated with leave-one-track-out within each listener; similarity: nDCG@5 against human similarity judgments if collected.
- Metrics: Spearman ρ, ROC AUC; bootstrap 95% intervals over tracks.
- Leakage control: split by track and by artist; no tuning on test folds.

**Interpretability study:** show pairs of songs with an explanation from (a) the signature compare view or (b) a feature table; participants rate understanding 1-7 and answer one comprehension question.

**Reporting:** pre-register the plan in `docs/DECISIONS.md` before collecting data; report all results including null ones; state limitations (small sample, Creative Commons corpus not representative of commercial music, liking is personal and contextual).

## 7. Deferred: commercial success

Exploratory only, after M11: HSP-S feature-only baseline vs fingerprint-like statistics computed from AcousticBrainz features. Confounds (artist fame, marketing, release timing) must be stated; no causal claims.
