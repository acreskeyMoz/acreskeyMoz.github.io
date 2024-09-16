
\
For multiplexed HTTP/2 and HTTP/3 connections, request priority is determined using the Extensible Prioritization Scheme, which considers Urgency (ranging from 0 to 7) and whether the request is Incremental (true/false). 
Resources with a low numerical urgency should be delivered before resources with higher numerical urgencies. e.g. all resources with urgency 2 should be transferred before resources with urgency 3 begin. 

The incremental flag specifies whether a bandwidth should be split between this resource and others other resources of the same urgency. i.e. should resources of the same urgency be sent sequentially (i=false) or incrementally (i=true).

 These priorities are calculated based on the following factors:

    Resource type and its placement within the document or viewport
    DOM preload scanner behavior
    Assigned Class of Service
    Use of the SupportsPriority attribute
    Application of PriorityHints (e.g., fetchpriority="high")


Class of Service may also affect scheduling of resources (e.g. delaying trackers which are classified as ClassOfService::Tail)
https://searchfox.org/mozilla-central/rev/c414b4538dd3c7e1dc674f7b66176e7c309afa95/netwerk/base/nsIClassOfService.idl#10-11


| Resource Type                                    | Class of Service | supportsPriority | Urgency | Incremental | Notes                               |
| ------------------------------------------------ | ---------------- | ---------------- | ------- | ----------- | ----------------------------------- |
| **HTML,** root document                          | UrgentStart (64) | PRIORITY_HIGHEST, -20 | `0`     | `true`        |                                     |
| **CSS (**`<head>`, render-blocking)\*\*          | Leader (1)       | PRIORITY_NORMAL, 0  |   `2`    | `false`     |                                     |
| **CSS (rel=preload)**                            | Leader (1)       | PRIORITY_HIGHEST, -20 | `0` | `false`         |                                   |
| **CSS (body)**                            |                  |                  |         | `false`         |                                   |
| **JavaScript (blocking)**                        |                  |                  |      | `false`     |                                     |
| **JavaScript (blocking, rel=preload)**           |                  |                  |      |`false`          |                                  |
| **JavaScript (async)**                           |                  |                  |      | `false`     |                                     |
| **JavaScript (defer)**                           |                  |                  |      | `false`     |     |
| **Font**                      |                  |                  |      | `false`     |                                     |
| **Font (rel=preload)**                          |                  |                  |      | `false`     |                                   |
| **Font (Non-render-blocking)**                  |                  |                  |      | `false`     |                                     |
| **Image**                      |                  |                  |      | `true`     | See:  image_layout_network_priority |
| **Image (rendered)**                      |                  |                  |      | `true`     | See:  image_layout_network_priority |
| **Image (rel=preload)**                         |                  |                  |      | `true`     |                                     |
| **Fetch**                                        |                  |                  |      | `false`     |                                     |
| Trackers                                         | Tail             |                  |      |             |                                     |

