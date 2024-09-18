# Firefox Network Scheduling and Prioritization

### Scheduling
Firefox employs several techniques to orchestrate network request scheduling:

#### DOM Preload Scanner (speculative loader)
    - Runs on a background thread, scans HTML for resource URLs to preload
    - Adds discovered resources to a speculative load queue
    - See [MDN Documentation on HTML Parser Threading (archived)](https://web.archive.org/web/20201021003137/https://developer.mozilla.org/en-US/docs/Mozilla/Gecko/HTML_parser_threading)

#### DOM Parser (non-speculative)
    - Makes requests for elemements as the tree is constructed.

#### [Class of Service](https://searchfox.org/mozilla-central/rev/f549a50b1e39b1e6bea19912d92545c4c0a06b7b/netwerk/base/nsIClassOfService.idl#7-15)
    - Categorizes requests (e.g., Leader, Normal, Follower, Speculative)
    - May defer scheduling of certain requests (e.g., trackers classified as ClassOfService::Tail)
    
### Priority
For multiplexed HTTP/2 and HTTP/3 connections, request priority is determined using the Extensible Prioritization Scheme, which considers Urgency (ranging from `0` to `7`) and whether the request is Incremental (true/false).

Resources with a low numerical urgency should be delivered before resources with higher numerical urgencies. e.g. all resources with urgency 2 should be transferred before resources with urgency 3 begin. 

The incremental flag specifies whether a bandwidth should be split between this resource and others other resources of the same urgency. i.e. should resources of the same urgency be sent sequentially (i=false) or incrementally (i=true).

 These priorities are calculated based on the following factors:

    • Resource type and its placement within the document or viewport
    • Assigned Class of Service
    • Use of the [SupportsPriority](https://searchfox.org/mozilla-central/rev/f549a50b1e39b1e6bea19912d92545c4c0a06b7b/xpcom/threads/nsISupportsPriority.idl#8-16) interface
    • Application of PriorityHints (e.g., fetchpriority="high")
    • Backgrounding tabs will lower their priority



| Resource Type                                    | Class of Service | supportsPriority | Urgency | Incremental | Notes                               |
| ------------------------------------------------ | ---------------- | ---------------- | ------- | ----------- | ----------------------------------- |
| **HTML,** root document                          | `UrgentStart (64)` | `PRIORITY_HIGHEST, -20` | `0`     | `true`        |                                     |
| **CSS (**`<head>`, render-blocking)\*\*          | `Leader (1)`       | `PRIORITY_NORMAL, 0`  |   `2`    | `false`     |                                     |
| **CSS (rel=preload)**                            | `Leader (1)`       | `PRIORITY_HIGHEST, -20` | `0` | `false`         |                                   |
| **CSS (body)**                                   | `Leader (1)`       | `PRIORITY_NORMAL, 0`  |   `2`    | `false`         |                                   |
| **JavaScript (blocking)**                        | `Leader (1)`       | `PRIORITY_NORMAL, 0` |  `2`  | `false`     |                                     |
| **JavaScript (rel=preload)**                     | `Unblocked (16)`   | `PRIORITY_HIGHEST, -20` | `1`  |`false`          |                                  |
| **JavaScript (async)**                           | `TailAllowed (512) Unblocked (16)` | `PRIORITY_NORMAL, 0` | 3 |  `false`     |                                     |
| **JavaScript (defer)**                           | `Unblocked (16)` | `PRIORITY_NORMAL, 0` | `3` | `false`     |     |
| **Font**                                         | `Leader (1)` |  `PRIORITY_NORMAL, 0` | `2`     |  `false`   |     |
| **Font (rel=preload)**                           | `TailForbidden (1024),  Unblocked (16)` |`PRIORITY_HIGH, -10` |  `2`| `false`     |                                   |
| **Image**                                        | `(0)`            |  `PRIORITY_LOW, 10`<br>`fetchpriority=high: PRIORITY_HIGH, -10` <br>`fetchpriority=low: PRIORITY_LOW, 10`        |`5`<br>`fetchpriority=high: 3`<br>`fetchpriority=low: 5`| `true`      |  |
| **Image (rel=preload)**                          |     `(0)`         |  `PRIORITY_LOW, 10`     | `5`  | `true`     |                                     |
| **Image (about to be rendered)**                             |    `(0)`           |   `PRIORITY_HIGH, -10`      |  `3` ** not confirmed **    | `true`     | See:  image_layout_network_priority |
| **Fetch**                                        |    `(0)`         |  `PRIORITY_NORMAL, 0`<br>`fetchpriority=high: PRIORITY_HIGH, -10` <br>`fetchpriority=low: PRIORITY_LOW, 10`| `4`<br>`fetchpriority=high: 3`<br>`fetchpriority=low: 5`   | `false`     |                                     |
| **Tracker (script)**                                         | `Tail (256), Unblocked (16)`     | `PRIORITY_NORMAL, 0`   |  `3`  |  Request is tailed, i.e. deferred by a constant * number of pending requests |

