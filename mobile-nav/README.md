# mobile-nav

A comparison dashboard for two new mozperftest Android suites:

| Test | Suite | Script | Metric |
|---|---|---|---|
| URL bar navigation | `newssite-urlbar-nav` | `ubne-newssite.sh` | time to the `urlbar_nav_end` frame |
| Hot applink | `newssite-hot-applink` | `hvne-newssite.sh` | time to the `hot_view_nav_end` frame |

Both run Fenix and Chrome against a locally served HTTP/2 copy of the
`newssite` (Nuxt) page in `testing/performance/mobile-startup/`, ten iterations
per job. Chrome is the baseline; a positive gap means Fenix is slower.

Open `index.html`. Optional query parameters: `?test=urlbar-nav|hot-applink`
and `?platform=<machine platform>`.

## Where the data comes from

Everything is read live in the browser; nothing is checked in or cached
server-side.

- **Signatures** — `treeherder.mozilla.org/api/project/try/performance/signatures/`,
  framework 15, filtered to the two suites and to the platforms listed in
  `CANDIDATE_PLATFORMS` in `mobile-nav.js`. Gecko-profile and simpleperf
  variants are excluded.
- **Runs** — `treeherder.mozilla.org/api/performance/summary/` per signature.
  One data point per CI job; the value is the mean of that job's ten iterations.
- **Videos and replicates** — the job's Taskcluster artifacts:
  `public/build/<suite>.tgz` holds `vidN_<app>.mp4`, one per iteration, and
  `public/build/perfherder-data-*.json` holds the matching replicate values.
  The archive is gunzipped with `DecompressionStream` and untarred in
  `parseTar()`, so there is no CDN dependency.

## Caveats baked into the UI

- Try pushes expire from Perfherder, and Taskcluster expires the video
  artifacts about four weeks after the push. When that happens the charts still
  work but the video inspector reports that the archive is gone.
- Fenix and Chrome do not always run on the same pushes. When the selected
  pushes differ between the two, or when either side has fewer than five runs,
  the headline shows a "Read with care" note rather than presenting the pooled
  median as like-for-like.

## Adding a test or platform

Add an entry to `TESTS` (suite name, the Perfherder subtest name used as the
metric, and the submetrics suite) or to `CANDIDATE_PLATFORMS`. Nothing else is
hardcoded — revisions are discovered from whatever Perfherder returns.

## Colours

Series colours are categorical slots 1 (blue, Chrome) and 2 (orange, Fenix)
from the shared data-viz palette, with separate steps for light and dark. Both
pairs pass the all-pairs CVD and normal-vision separation checks and clear 3:1
against their surface.
