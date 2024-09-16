
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
| **HTML,** root document                          |                  |                  | `0`     | `true`        |                                     |
| **CSS (**`<head>`, blocking render-blocking)\*\* |                  |                  |       | `false`     |                                     |
| **CSS (rel=preload)**                            |                  |                  |         | `false`         |                                   |
| **JavaScript (blocking)**                        |                  |                  |      | `false`     |                                     |
| **JavaScript (blocking, rel=preload)**           |                  |                  |      |`false`          |                                  |
| **JavaScript (async)**                           |                  |                  |      | `false`     |                                     |
| **JavaScript (async, rel=preload)**              |                  |                  |      | `false`          |                                 |
| **JavaScript (defer)**                           |                  |                  |      | `false`     |     |
| **JavaScript (defer, rel=preload)**              |                  |                  |      | `false`     |                                   |
| **Fonts (Render-blocking)**                      |                  |                  |      | `false`     |                                     |
| **Fonts (rel=preload)**                          |                  |                  |      | `false`     |                                   |
| **Fonts (Non-render-blocking)**                  |                  |                  |      | `false`     |                                     |
| **Fonts (Non-render-blocking, rel=preload)**     |                  |                  |      | `false`     |                                   |
| **Images (rendered)**                      |                  |                  |      | `true`     | See:  image_layout_network_priority |
| **Images (rel=preload)**                         |                  |                  |      | `true`     |                                     |
| **Fetch**                                        |                  |                  |      | `false`     |                                     |
| Trackers                                         | Tail             |                  |      |             |                                     |

