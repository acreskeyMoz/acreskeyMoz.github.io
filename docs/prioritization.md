## Firefox Network Scheduling and Prioritization

# Scheduling
Firefox employs several techniques to optimize network request scheduling:

DOM Speculative Load Scanner

    Runs on a background thread
    Scans HTML for resource URLs to preload
    Adds discovered resources to a speculative load queue

See: https://web.archive.org/web/20201021003137/https://developer.mozilla.org/en-US/docs/Mozilla/Gecko/HTML_parser_threading

Class of Service

    Categorizes requests (e.g., Leader, Normal, Follower, Speculative)
    Affects scheduling priority
    May delay lower priority requests (e.g., trackers classified as ClassOfService::Tail)

# Priority
For multiplexed HTTP/2 and HTTP/3 connections, request priority is determined using the Extensible Prioritization Scheme, which considers Urgency (ranging from `0` to `7`) and whether the request is Incremental (true/false).

Resources with a low numerical urgency should be delivered before resources with higher numerical urgencies. e.g. all resources with urgency 2 should be transferred before resources with urgency 3 begin. 

The incremental flag specifies whether a bandwidth should be split between this resource and others other resources of the same urgency. i.e. should resources of the same urgency be sent sequentially (i=false) or incrementally (i=true).

 These priorities are calculated based on the following factors:

    • Resource type and its placement within the document or viewport
    • DOM preload scanner behavior
    • Assigned Class of Service
    • Use of the SupportsPriority interface
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
| **Font (rel=preload)**                          | `TailForbidden (1024),  Unblocked (16) |`PRIORITY_HIGH, -10` |  `2`    | `false`     |                                   |
| **Image**                                        | `(0)`      |  `PRIORITY_LOW, 10`  |  `5`<br>`fetchpriority=high`: `3`     | `true`     |  |
| **Image (rendered)**                      |                  |                  |      | `true`     | See:  image_layout_network_priority |
| **Image (rel=preload)**                         |     `(0)`          |  `PRIORITY_LOW, 10`     | `5`  | `true`     |                                     |
| **Fetch**                                        |                  |                  |      | `false`     |                                     |
| **Tracker**                                         | `Tail (256)`            |                  |      |             |                                     |

