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

## What it shows

The page leads with the two screen captures side by side, because the point is
to watch where Fenix loses the time rather than to read a number. Each pane
loads on its own:

- **Job** — the run at the median of that browser's selected runs. With an even
  number of runs there is no job sitting exactly on the median, so the upper of
  the two middle runs is used.
- **Iteration** — within that job, the one whose replicate is closest to the
  job's median replicate.

That default follows the push filter: narrow the pushes and each pane moves to
the new median. Choosing a job by hand, either from the pane's picker or by
clicking a dot in *Every run*, pins the pane until "Back to median runs".
The pane's subtitle says which of the two you are looking at.

Below the videos are the headline medians and a dot-per-job strip plot, with
per-lane summary statistics behind the table-view disclosure.

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

- Both median videos are fetched as soon as the Perfherder data resolves, which
  is roughly 40 MB. Switching test or platform re-fetches; the last four
  archives are kept in memory, so switching back is free.
- Try pushes expire from Perfherder, and Taskcluster expires the video
  artifacts about four weeks after the push. When that happens the charts still
  work but the video panes report that the archive is gone.
- Fenix and Chrome do not always run on the same pushes. When the selected
  pushes differ between the two, or when either side has fewer than five runs,
  the headline shows a "Read with care" note rather than presenting the pooled
  median as like-for-like.

## Adding a test or platform

Add an entry to `TESTS` (suite name and the Perfherder subtest name used as the
metric) or to `CANDIDATE_PLATFORMS`. Nothing else is hardcoded — revisions are
discovered from whatever Perfherder returns.

## Colours

Series colours are categorical slots 1 (blue, Chrome) and 2 (orange, Fenix)
from the shared data-viz palette, with separate steps for light and dark. Both
pairs pass the all-pairs CVD and normal-vision separation checks and clear 3:1
against their surface.
