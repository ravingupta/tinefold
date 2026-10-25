Working on a new project setting up an analytics service for the company. We are using Amplitude but it is getting way more costly as we are scaling so for now we want to shift few events to our service which are not use for product growth instead mostly for engineers so that we can cut down on amplitude budget. Now, I was searching about it and kind of landed on using athena and direct parquet write instead of using kenisis/kafka stream to keep the budget low, but now the problem is warehousing.

But now let's start from the beginning and go step by step understanding the each decision and finalizing each decision one at a time. This will help me to go deeper and understand each smallest thing and have a full in depth understand of how it's gonna work and be aware of what decisions we took and why and how.

Let’s do this properly, one decision at a time. Here’s the full sequence first, so you can see where each piece fits. The order matters, because each decision constrains the ones after it.

The decision chain
#	Decision	Core question
1	Requirements & workload shape	What volume, which queries, how fresh, how long kept?
2	Ingestion contract	How do events get from producers to us? (SDK, HTTP collector, server-side only?)
3	Buffering & batching	Who batches events into files? (app, Firehose, Kafka, a queue)
4	Storage layout	Parquet file sizing, partitioning scheme, compaction
5	Table format & catalog	Raw Glue tables vs Iceberg. This is your “warehousing” problem.
6	Query layer	Athena config, workgroups, cost guardrails, views/rollups
7	Schema governance	Event schemas, evolution, validation, PII
8	Operations	Monitoring, data loss detection, retention, cost tracking
One flag before we start. Your current design, with apps writing Parquet directly, quietly collapses decisions 3 and 4 into the application tier. That’s where most of the hidden pain lives: small files, events lost when an instance dies with a buffer in memory, and every service needing Parquet logic. It may still be the right call, but we’ll decide it on purpose in step 3 rather than inherit it by accident.

Decision 1: Requirements & workload shape
The principle: in analytics systems, query patterns drive cost and design far more than write volume. Amplitude charges per event. Athena charges about $5 per TB scanned. So your cost model moves from “how much do we send” to “how much do we read, and how well is it laid out.” That’s the mental shift for this whole project.

I need these answers before anything else is decided. Each one notes what it drives.

Volume. Roughly how many events per day are moving off Amplitude, and what’s the average payload size?
This drives whether app-level batching is even viable, and whether you’ll have a small-files problem.
Producers. Are these events server-side only (backend services), or also client-side (web or mobile)?
Client-side events need a public collector, auth, abuse protection, and handling for late or offline events. That’s a completely different ingestion design.
Freshness. How stale can the data be? Seconds, minutes, or hours?
Hourly freshness makes cheap batch designs possible. Near-real-time forces streaming, which is the cost you’re trying to avoid.
Query patterns. Who queries, and how? For example: ad-hoc SQL by engineers, dashboards in Grafana or QuickSight, or debugging a single user or request.
Dashboards that refresh repeatedly can make Athena surprisingly expensive. Single-user lookups argue for different partitioning than aggregate queries do.
Retention & correctness. How long must data be kept? Is losing about 0.1% of events acceptable, or do you need at-least-once delivery with deduplication?
Loss tolerance decides how much durability the buffering layer needs, and this is where “direct write from the app” gets risky.
Shape stability. Are event schemas fairly fixed, or do engineers add properties freely, the way they do in Amplitude?
Free-form properties are the main reason table format matters (Iceberg vs raw Glue).
A transferable pattern: for any data system, characterize the workload first (write rate, read pattern, freshness, durability) before picking components. Most bad architectures come from choosing the tool first, for example “Kafka because it’s standard,” and backfilling the requirements afterward.

Send me your answers, even rough numbers, and we’ll lock Decision 1 and move on to ingestion.

At each step, compare and tell me about how it is done in Amplitude as an eg/reference for me to understand how these companies do it for even much bigger scale and what matter to us in comparison to answer why we are making this different decision.

Good addition. Comparing against Amplitude is the right way to judge these choices, because it shows which of their requirements you’re actually paying for and which ones you can safely drop. That’s the real logic behind build vs. buy.

Here’s Decision 1 again, with Amplitude as the reference point.

Decision 1: Requirements & workload shape, compared with Amplitude
Dimension	Amplitude’s answer	Why they need it	What it likely means for us
Volume	Trillions of events across thousands of customers	Multi-tenant SaaS: scale is everyone’s traffic combined	One company, a subset of events. Probably millions per day, not billions.
Producers	Client SDKs (web, iOS, Android) plus HTTP API, with batching, retries and offline queues built in	Customers send from anywhere, including untrusted devices	If the events are server-side only, we skip most of this complexity
Freshness	Near-real-time (events show up within seconds to minutes)	PMs watch live launches and funnels; freshness is a selling point	Engineers debugging trends can likely live with 15–60 minutes
Query pattern	Interactive, sub-second funnels, retention and cohorts over arbitrary properties, served by their own columnar engine (Nova)	Non-technical users click around a UI; slow queries would kill the product	Engineers writing SQL can tolerate 5–30 second queries
Correctness	At-least-once delivery, with deduplication via insert_id over a multi-day window	Paying customers notice missing or double-counted events	Engineering metrics can usually tolerate small loss. This needs your confirmation.
Schema	Schemaless ingest (any property, any time), with governance layered on later through tracking plans	Customers would never accept rigid schemas	We can enforce schemas up front, because we control the producers
The Amplitude details above are based on their public docs and engineering posts, at a high level. Treat them as directional, not as exact internals.

The core insight
Amplitude’s architecture (streaming ingest, an in-house columnar engine, real-time indexing) exists to serve interactive, real-time, schemaless, multi-tenant product analytics. Your workload is the opposite on almost every axis: internal, tolerant of delay, run by people who write SQL, with producers you control.

That gap is the whole justification for Athena plus Parquet. You’re not building a cheaper Amplitude. You’re building a system for a different workload, one that doesn’t need the expensive properties.

The flip side, and the main risk: if engineers later expect Amplitude-like behaviour (live dashboards, ad-hoc slicing on any property), this design will disappoint. Writing the non-goals down now is a Staff-level move. It stops scope creep, such as “can we just add real-time?”, from quietly turning this into a worse Amplitude.

Pattern to reuse
When you’re evaluating whether to replace a vendor, list the vendor’s design requirements, not just its features. Then mark each one as “we need it,” “we don’t,” or “we need a weaker version.” Your savings come from the “don’t” column, and your risk comes from anything you misjudged in it.

To lock Decision 1, I still need your answers to the six questions from before. The most important ones are:

Events per day, and roughly how many bytes per event
Server-side only, or client events too
Acceptable freshness
Tolerance for losing some events
Once we have those, we’ll move on to Decision 2 (the ingestion contract) and look at how Amplitude’s SDKs and HTTP API handle it.

Volume:
I don't know how many will transfer but currently we have 1 billion events in a year in amplitude, hoping to touch a scale of 1.5 billion events next year. We can start with migrating 30% to our service but with our service we will be adding extra events also because we have a cheaper service available so developers will be less pragmatic about it I guess.

Producers: These are mostly mobile app events but very few will be website and even very very few server side also.

We will be using Firehose I believe not to add / pay the cost of any stream but let's discuss that later, Definitely not directly parquet files for sure atleast Firehose.

Freshness: We don't need realtime, faster the better but hourly waits are fine.

Query patterns: I don't know, but one thing is possible. We usually download all the data from Amplitude on daily basis into dynamo with white list, so keeping similar things like easily downloadable for daily dumps and all those amplitude stuff. These events will be queried by mostly developers only, I don't need any dashboards like amplitude for everything but sometimes we will make some dashboards to view data.

Retention: Keeping it as long as possible, if possible lifetime.

Correctness: We would love to keep it 100% correct basically as high as possible. Direct by app was bad decision, atleast firehose is necessary.

Shape stability: Free shape, we don't have standard shape of properties. We can define some standards but would still keep the shape free also to add more properties on the go just like amplitude.

Comparing with Amplitude I meant when we will be going step by step through the whole system setup then I would love to compare my decision choices with Amplitude setup and how it affects things and also keep your recommended choice for me at every step with reason. Target to keep the cost lower with keeping the long term scalability in mind.


Searched the web
Searched the web
Decision 1: Locked
Your numbers, translated into what we design for:

Metric	Value
Year 1 events	About 0.5–1B per year (30% of 1.5B is roughly 450M, plus new events added because “it’s cheap now”)
Design target (10x headroom)	About 10B per year ≈ 27M per day ≈ 300 events/sec average, with peaks of 1–2k/sec
Storage size	Around 1 KB of JSON per event shrinks to about 100–150 bytes as compressed Parquet, so 1B events is roughly 100–150 GB per year
What these requirements imply:

Lifetime retention is cheap. About 150 GB a year on S3 costs a few dollars a month, and you can move older data to cheaper storage tiers later. Storage is not your cost problem.
Firehose is also cheap at this scale. Ingestion is billed per GB in 5KB increments (a 3KB record is billed as 5KB), at roughly $0.029/GB. Even with that 5x rounding overhead, the cost is low hundreds of dollars a year. 
amazon
amazon
Your real cost risks are elsewhere:
Athena scans, since every query is billed by the bytes it reads.
Undisciplined event growth. You flagged this yourself, and it means we’ll need guardrails later.
Mobile producers drive much of the design: offline queues on the device, unreliable client clocks, events arriving days late, and a public endpoint that has to be exposed safely.
“100% correct” needs a precise definition. Realistically it means: at-least-once delivery, plus deduplication by event ID, which gives you effectively exactly-once data in the table. The hard limit is loss on the device itself, for example when an app is uninstalled before it flushes its queue. Amplitude hits the same limit.
Free-form properties point strongly toward Iceberg in Decision 5. Parked until then.
Decision 2: Ingestion contract (how events get from the app to Firehose)
This decision has three parts: which SDK sends events, how events get routed, and what receives them.

How Amplitude does it
Layer	Amplitude
SDK	Persists events on the device, batches them, retries with backoff, splits batches that are too large, backs off when throttled, and attaches an insert_id to each event
Endpoint	HTTP API that validates events and returns 200 only once they’re durably accepted into their pipeline
Server role	Stamps a server receive time (because client clocks drift) and deduplicates on insert_id over a multi-day window
Principle	The edge is dumb and stateless. All heavy work happens downstream.
Most of the hard reliability engineering lives in the SDK. Rebuilding that across iOS, Android and web is where in-house analytics projects quietly lose months.

2a. Which SDK sends events to us
Option	Pros	Cons
A. A second Amplitude SDK instance with its server URL pointed at our collector	Reuses Amplitude’s proven offline queue, retries and batching. Nothing new on mobile. Same payload shape as your existing data.	Couples you to the Amplitude SDK. You need to keep identity (user, device and session IDs) in sync between the two instances.
B. An open-source SDK (RudderStack, Snowplow)	Vendor-neutral, mature	A second SDK in the app, more app size, and a different data shape
C. Build your own SDK	Full control	You’d have to rebuild offline persistence and retries on three platforms. That’s high risk with no real payoff.
Recommendation: A. You keep the most expensive part of Amplitude’s system, the reliable SDK, for free. Your collector accepts Amplitude’s HTTP API v2 payload format. That keeps the contract familiar, and it keeps things reversible: an event can move back to Amplitude with a config change.

Caveats to check: multi-instance support and custom server URLs depend on your SDK versions. Confirm you’re on the current Swift, Kotlin and React Native SDKs, not the legacy ones.

2b. Routing (which events go where)
Put a thin track() wrapper in the app that sends each event to instance A (Amplitude) or instance B (ours), based on an allowlist delivered by remote config.
Why remote config matters on mobile: old app versions stay in use for months. If the routing list is hard-coded, every change waits on app releases and adoption. Remote config lets you move events between destinations instantly.
Policy decision: brand-new events should default to ours. Teams then have to opt in to Amplitude for growth events. That keeps the Amplitude bill falling over time instead of creeping back up.
2c. The collector
Option	Cost at 1B/yr	Cost at 10B/yr	Notes
API Gateway HTTP API + Lambda	About $50–100 per year	About $500–1k per year	Scales to zero, no servers to run
ALB + ECS (Fargate)	About $70–100 per month flat	Similar	Only wins at much higher, steady traffic
These estimates assume the SDK batches around 20 events per request.

Recommendation: API Gateway + Lambda. Your traffic is bursty and modest. Cold starts don’t matter, because the SDK sends in the background.

The collector’s contract (this is where correctness is won or lost)
Validate each event’s shape and size.
Respond 400 for bad data, so the SDK drops it instead of retrying forever.
Stamp server_received_at. Never trust client clocks for partitioning.
Require a client-generated insert_id. If the server generated it instead, a retried request would get a new ID and slip past deduplication.
Pack many events into one Firehose record (newline-delimited JSON). This removes the 5KB rounding cost for free.
Return 200 only after Firehose confirms the write.
Handle partial failures from the batch write call.
Return 5xx or 429 so the SDK retries. This is what gives you at-least-once delivery.
Don’t deduplicate here. The collector stays stateless, and deduplication happens downstream (Decision 4 or 5).
Pattern to remember: accept quickly, acknowledge only once the data is durable, process later. Keeping the edge stateless is why systems like this scale horizontally without coordination. Amplitude, Segment and Snowplow all follow this shape.

To lock Decision 2, confirm:
Are your mobile apps on the current Amplitude SDKs (Swift, Kotlin, React Native), or the legacy ones?
Are you OK with the policy that new events default to our service?
Next is Decision 3: Firehose configuration: buffering, converting to Parquet vs. keeping raw JSON, and dynamic partitioning, compared with Amplitude’s Kafka-based pipeline.

Sources:

Amazon Data Firehose pricing
Put a thin track() wrapper only for our service events for developers to choose between the method based on the requirement instead of additional step of allowlist which can be missed easily.

I like the idea of remote list on top to migrate the current ongoing events if required.

no new events policy as we want to make more room in Amplitude to fire more growth events.

I would not risk cold start problem to save 20$, this events service once attached will be getting events 24/7 rarely getting a free window inbetween.

Your Decision 2 calls, reviewed
1. Explicit trackInternal() instead of an allowlist: agreed. This is better than what I proposed.

Why: routing becomes visible at the call site, so the decision gets reviewed in a PR rather than living in a list somewhere else. Explicit beats implicit.
What you’re trading: the destination is fixed into each app version. Your remote list covers migrating existing events, so that’s handled.
Define one rule now: the remote list can only move events from Amplitude to ours, never the reverse. Precedence that goes only one way stays predictable. Without it, nobody can answer “where did this event go?” when debugging at 3am.
Guardrail: write a one-line guideline (“does Growth or Product look at this? → track(), otherwise trackInternal()”) and add a lint rule or PR template check. Without it, developers who aren’t sure will pick Amplitude, and the bill creeps back up.
2. No default policy: makes sense, because explicit methods make a default unnecessary.

3. Fargate over Lambda: I agree with the choice, but the reasoning needs a correction.

Steady 24/7 traffic actually makes cold starts rarer. Lambda keeps environments warm while they’re busy, and cold starts mostly happen when it scales out. SDK sends also run in the background, so latency hardly matters.
The real reasons Fargate is the better call for you:
At 10x scale the cost is roughly equal. About 500M requests a year comes to around $80/month on Lambda, similar to Fargate’s flat cost. After that crossover, Fargate wins.
Persistent connections to Firehose and steady throughput.
Node/Express is your expert stack, which makes local development and debugging easier.
Amplitude also runs long-lived ingestion servers, not serverless functions.
What you take on in exchange:
At least 2 tasks across availability zones.
Autoscaling on CPU or request count.
Health checks.
Graceful shutdown: on a deploy, finish in-flight Firehose writes before exiting.
Never buffer events in memory before acknowledging. A task that gets killed would silently lose events.
Decision 2: Locked
Apps use the Amplitude SDK, with a second instance for our events. Developers send our events with trackInternal(); a remote list moves existing events from Amplitude to ours, one direction only. Traffic goes through an ALB to a stateless Express collector on Fargate, which validates, stamps the server time, packs events into records, and returns 200 only after Firehose confirms.

Decision 3: Firehose configuration
How Amplitude does it
Ingested events go into Kafka, a durable, replayable log. If a downstream bug corrupts data, they reprocess from the log. Their query store (Nova) is built from that log; it is not the source of truth.

Our equivalent: a raw S3 landing zone plays the role of Kafka’s log. It’s slower to replay, but far cheaper, and you can keep it forever.

3a. Convert to Parquet inside Firehose, or land raw JSON?
Option	Pros	Cons
Firehose converts JSON to Parquet	One fewer job to run	Needs a fixed Glue schema, so fields missing from the schema can be lost (verify the exact behaviour for nested properties). That clashes with your free-form properties. Also no deduplication, and no raw copy to replay from.
Land raw gzip NDJSON in S3, convert downstream	An immutable source of truth. Schema-free. Replayable. Deduplication happens during conversion.	One more scheduled job
Recommendation: raw landing. Free-form properties plus “100% correct” make a replayable raw layer essential. Lifetime raw storage costs very little. This is the standard bronze → silver (medallion) pattern.

3b. Buffering
Max it out: 128 MB or 900 seconds, whichever comes first. Your freshness requirement is hourly, so bigger buffers mean fewer files and cheaper queries. You’ll get roughly 96 files a day, and downstream compaction reshapes them anyway.

3c. Partitioning the raw zone
Skip dynamic partitioning. It costs extra per GB and per object.
Use Firehose’s free timestamp prefix: raw/dt=YYYY-MM-DD/hr=HH/.
That timestamp is arrival time, which is correct for the raw zone. Mobile events can arrive days late, and arrival-time partitions mean you never have to rewrite old partitions to fit them in. Partitioning by when the event actually happened belongs to the silver layer (Decision 4).
3d. Smaller settings
Compression: GZIP.
Errors: a separate errors/ prefix, plus a CloudWatch alarm on delivery failures.
Streams: one stream per environment, not one per app. Keep platform as a field in the event instead.
Pattern: keep an immutable raw log and treat everything downstream as a rebuildable view. That turns bugs in transformation logic from data loss into “rerun the job.”

To lock Decision 3, confirm:
Raw JSON landing with conversion downstream?
Arrival-time partitions for the raw zone?
Next is Decision 4: the silver layer: converting to Parquet, deduplicating, event-time partitioning, and handling late events. That’s where your warehousing question really begins.

Define one rule now: the remote list can only move events from Amplitude to ours, never the reverse. I agree

Guardrail: Instead of guideline, we will document it properly everywhere so that even AI generate code know and uses that wisely.

Both locked.

Strengthening the documentation guardrail: write the rule where both developers and AI tools actually look, so it isn’t missed.

On the method itself. Put a JSDoc or docstring on track() and trackInternal() that states the rule and gives an example. AI tools read function signatures more reliably than wiki pages.
In your repos’ AI instruction files (CLAUDE.md, AGENTS.md, Cursor rules). This is where code assistants pick up project conventions.
In the type system, which is the strongest option. Split event names into two typed sets, for example GrowthEvent and InternalEvent, with each method accepting only its own set. A wrong call then fails to compile instead of depending on someone reading the docs.
The principle: documentation tells people what’s right, but types make the wrong choice impossible. Use docs for the why, and let the compiler enforce the what. Amplitude takes the same approach with tracking plans in their Data/Govern product: typed, generated SDK methods (Ampli) validate events against the plan, rather than relying on guidelines.

You haven’t confirmed Decision 3 yet:

Raw gzip NDJSON landing in S3, with conversion to Parquet downstream (no Firehose format conversion)?
Partitioning the raw zone by arrival time (dt=/hr=), with no dynamic partitioning?
Once you confirm, we’ll go to Decision 4 (the silver layer).

I would prefer Firehose converts JSON to Parquet but your reason of not having free-form properties will be a problem. How much size will gonna increase as Parquet I know if highly compressed. Is there any way to store Parquet with free form data.

Buffering: doesn't mean forcing it for 1 hour sync, we can keep a 10 min buffer or even shorter if possible without increasing the cost too much.

Good pushback. It changes Decision 3, but in a way that keeps the replay guarantee intact.

1. How much bigger is raw JSON than Parquet?
Format	Compression vs plain JSON	1B events/yr
Gzip NDJSON	About 5–10x (event JSON repeats keys, so it compresses well)	About 150–250 GB
Parquet (Snappy or ZSTD)	About 8–15x	About 100–150 GB
Storage is not the deciding factor here. The difference is roughly 1.5x, a few dollars a month.

The real Parquet advantage is query cost. Parquet stores data by column. Athena reads only the columns a query touches, and skips whole blocks using min/max statistics. Gzip JSON forces Athena to read every byte. So Parquet matters for anything you query often.

2. Can Parquet hold free-form data? Yes, with a hybrid schema
Fixed core columns:

insert_id, event_type, event_time, server_received_at
user_id, device_id, session_id
platform, app_version
Flexible columns:

properties as a JSON string
user_properties as a JSON string
_extra as a JSON string: a catch-all for any unexpected top-level field
Two details make this work:

The collector converts properties to a string before sending it to Firehose. Firehose then sees a fixed schema, and conversion never drops anything.
Querying: use json_extract_scalar(properties, '$.screen') in Athena.
The trade-off: filtering on any property reads the whole properties column, not just that one key. Core columns stay fully efficient.
The pattern that makes this scale is promoted columns. When a property shows up in a lot of queries (for example screen_name or error_code), promote it to a real column. Start schemaless and add structure where the queries show you need it. Iceberg in Decision 5 makes adding a column a cheap metadata change.

Other options, briefly:

MAP<string,string>: loses value types, and gives no per-key pruning either. Worse than a JSON string.
VARIANT type: newer Iceberg and Parquet versions add a native semi-structured type that can extract hot keys into real columns automatically. It’s the long-term answer, but check whether Athena supports it yet before relying on it.
How Amplitude does it: its engine (Nova) turns each property into its own internal column dynamically, so every property is as efficient to query as a core column. That’s custom engine work you can’t get cheaply. JSON column plus promoted columns is the affordable approximation.

3. Revised Decision 3: Firehose converts to Parquet
The key insight: what makes the raw layer replayable is that it’s lossless, not that it’s JSON. If every incoming byte lands in some column (core, properties, _extra), the Parquet raw layer is just as replayable as raw JSON.

What you gain:

Raw data is directly queryable and cheap to scan
One fewer conversion job
What you accept:

A format-conversion charge of about $0.018/GB
Deduplication still has to happen downstream, in Decision 4
One thing to verify: whether Firehose format conversion accepts several JSON events packed into one record. If it doesn’t, each event is billed at the 5KB minimum for both ingestion and conversion. That works out to about $235/yr at 1B events and about $2.3k/yr at 10B. Still acceptable, but worth knowing.

4. Buffering
Firehose bills per GB, so a shorter buffer doesn’t raise Firehose’s cost. What a shorter buffer creates is more, smaller files, which slow down queries.
Constraint: with format conversion on, Firehose requires a minimum buffer size of 64 MB. The interval is still adjustable, and whichever limit is hit first triggers a flush.
At Year 1 volume (about 2 MB/min of raw data), a 10-minute buffer gives about 144 small Parquet files a day of a few MB each. That’s fine, because the silver layer compacts them.
Recommendation: a 300–600 second interval (5–10 minutes). That’s near-real-time enough for developers, and the small files get cleaned up downstream.

To lock revised Decision 3, confirm:
Firehose converts to Parquet, using the hybrid schema (core columns plus JSON string columns, with the collector stringifying them).
A 5–10 minute buffer.
Arrival-time partitions for raw (dt=/hr=).
Next is Decision 4: the silver layer (deduplication, event-time partitioning, compaction, late events).

Firehose converts to Parquet
10 minute buffer (might be 5 min if we decide later at implementation time)
Arrival-time partitions for raw: Should not this be event fire time instead.

Good question. Event time is what you’ll query by, but it’s the wrong thing to partition raw data by. The two layers do different jobs.

Why the raw layer uses arrival time
1. Late events would keep reopening old partitions.
Mobile devices go offline and flush their queues hours or days later. If raw were partitioned by event time, today’s Firehose output would scatter into partitions for last week, last month, even last year.

Old partitions are never final, so downstream jobs can’t know what changed since their last run.
With arrival time, each hour’s partition is append-only and immutable once the hour ends. Incremental processing becomes simple: “process every arrival hour after my last checkpoint.”
2. Client clocks can’t be trusted.
Devices report 1970, 2038, or times that are hours off. Partitioning by client time creates junk partitions. Arrival time is stamped by your server, so it’s always valid.

3. It’s cheaper and produces fewer files.
Arrival-time prefixes are free in Firehose. Event-time partitioning needs dynamic partitioning, which costs extra per GB and per object. It also splits every 10-minute flush into one small file per event date it contains.

Where event time belongs: the silver layer
Layer	Partitioned by	Purpose
Raw (bronze)	Arrival time	Append-only log; drives incremental processing
Silver	Event time (date)	What developers query: “what happened on Oct 15?”
The silver job reads newly arrived raw partitions, deduplicates them, and writes rows into the right event-date partitions, including old dates when events arrive late. A table format like Iceberg makes that safe; that’s Decision 5.

How Amplitude handles it
Amplitude stores both timestamps: the client’s event time and the server’s receive or upload time. It ingests in arrival order and indexes by event time for charts. Same separation, different engine.

A related technique worth adopting: clock-skew correction. Have the SDK send its upload time with each batch. The collector then computes:

corrected_event_time = event_time + (server_received_at − client_upload_time)

That cancels out a device clock that’s simply wrong. Segment uses this pattern. Keep the original client timestamp too, so nothing is lost.

The general principle: partition the write path by something you control and that only moves forward (arrival time). Partition the read path by whatever queries filter on (event time). The same idea shows up in log systems, CDC pipelines and stream processing as processing time vs. event time.

Decision 3, ready to lock:

Firehose converts to Parquet, using the hybrid schema.
10-minute buffer (5 minutes is an option to revisit during implementation).
Raw partitioned by arrival time, with event time stored as a column.
The collector adds clock-skew correction.
Confirm, and we’ll move to Decision 4: the silver layer (deduplication, event-time partitioning, compaction, late-event handling).

All confirmed.

Decision 4: The silver layer
What silver does: it reads newly arrived raw partitions, removes duplicates, cleans timestamps, and writes the result into tables partitioned by event time. This is the layer developers query.

One dependency up front: the silver layer needs row-level merges, and Athena only supports MERGE on Iceberg tables. So this decision assumes Iceberg for silver. Decision 5 will test that assumption against the alternatives.

How Amplitude does it
Concern	Amplitude
Deduplication	Drops repeat events with the same insert_id within a 7-day window
Late events	Accepted and shown under their original event time
Bad timestamps	Stores the server receive time alongside the client time
Their window is a deliberate trade-off: enough to catch SDK retries and devices that were offline, without the cost of checking for duplicates across all of history.

4a. Deduplication strategy
Option	Cost	Correctness
Deduplicate only within each incoming batch	Cheapest	Misses retries that land in different hours
Check against the whole table	Grows forever	Perfect, but cost scales with all of history
Check only the partitions the batch touches	Proportional to the batch	Effectively perfect
The insight behind the recommended option: a retried event has the same insert_id and the same event time, so it lands in the same date partition. The merge only needs to check partitions that appear in the incoming batch. A late event from last March reads only last March’s partition.

There’s one edge case. Clock-skew correction can shift a retried event across midnight by a few seconds. So match on insert_id within event_date ± 1 day.

Recommendation:

First remove duplicates within the batch by insert_id.
Then merge against the silver partitions the batch touches, using a ±1 day match.
This is stronger than Amplitude’s window, because there’s no time limit at all.

4b. Silver partitioning and file layout
Partition by day(event_time). At your volume (roughly 50 MB to 1.5 GB of Parquet per day, even at 10x), hourly partitions would only produce small files.
Don’t partition by event_type. Hundreds of event types would mean thousands of tiny partitions.
Sort files by event_type, then user_id. Parquet’s per-block min/max statistics then let Athena skip most of each file for queries like “event X for user Y.” You get most of the pruning benefit with none of the partition explosion.
Pattern: partition on low-cardinality columns that almost every query filters on (date). Use sort order for high-cardinality columns (event type, user).

4c. Timestamp sanity rules
If the corrected event time is more than a day in the future, or earlier than your app’s launch, replace it with server_received_at and set time_corrected = true.
This keeps junk partitions (1970, 2038) out of the table.
4d. How often it runs, and how fresh data is
Recommendation: run every hour. That gives two tiers of freshness:

Need	Query	Delay
“Did my event just fire?”	Raw (Parquet, queryable as soon as Firehose writes it)	About 10 minutes
Analysis, dashboards, exports	Silver (deduplicated and clean)	About 1 hour
4e. Late events and your daily DynamoDB export
Late events have a consequence that’s easy to miss: an export of “yesterday” run at 1am will miss events that arrive later.

Options:

Export by arrival date. Each run exports “everything new since last run,” which is complete and never duplicates rows. This works if DynamoDB writes are upserts keyed by insert_id.
Re-export the last N days each run. Simpler to reason about, but it scans more data.
Recommendation: export by arrival date, with upserts by insert_id. That’s incremental and idempotent. Records will need an arrived_at column in silver.

4f. Engine
Option	Fit
Athena SQL (MERGE), triggered by EventBridge and orchestrated with Step Functions	Serverless, SQL only, costs cents per run at your volume
Glue Spark	You pay a per-DPU minimum. Overkill until you’re at much larger scale.
dbt on Athena	Adds model versioning and tests on top of Athena. A good evolution once you have many models.
Recommendation: start with Athena MERGE plus Step Functions, and adopt dbt when you have more than about 5 derived tables.

To lock Decision 4, confirm:
Deduplicate by checking only the partitions each batch touches (±1 day), with no time window.
Partition silver by event date, with files sorted by event_type and user_id.
Hourly silver runs, while raw stays available for checks that need the last few minutes.
The DynamoDB export runs by arrival date, with upserts by insert_id.
Next is Decision 5: table format and catalog (Iceberg vs. Hive-style Glue tables). We’ll also cover compaction and snapshot maintenance, and how to register the raw layer.

Before we proceed, please recap what is decided so far, I am coming back to this after 2-3 days now.

Here’s where things stand. Decisions 1–3 are locked, and Decision 4 is proposed but waiting on your confirmation.

Goal
Move engineering-only events off Amplitude to cut cost. Keep Amplitude for growth events, and free up room there to send more of them. The aim is low cost now with long-term scalability.

Decision 1: Requirements (locked)
Volume: about 0.5–1B events/yr in Year 1. Design target is 10x: ~10B/yr, ~300 events/sec average, peaks of 1–2k/sec.
Producers: mostly mobile, some web, very little server-side.
Freshness: hourly is fine; faster is better.
Retention: lifetime.
Correctness: as close to 100% as possible. That means at-least-once delivery plus deduplication; the only unavoidable loss is on the device itself.
Schema: free-form properties, like Amplitude.
Consumers: developers running SQL, occasional dashboards, and a daily export to DynamoDB.
Key insight: storage and ingestion are cheap at this scale. The real cost risks are Athena scans and developers adding events freely.
Decision 2: Ingestion contract (locked)
SDK: a second Amplitude SDK instance with its server URL pointed at our collector. This reuses Amplitude’s offline queue, retries and batching.
Routing: developers explicitly call trackInternal() for our service and track() for Amplitude.
Remote list: used only to migrate existing events, and one-way only (Amplitude → ours).
Guardrails: document it on the methods themselves and in AI instruction files, and ideally enforce it with typed event-name sets so the compiler catches mistakes.
Collector: ALB in front of a stateless Node/Express service on Fargate (at least 2 tasks across availability zones). Chosen for steady 24/7 traffic, cost parity at 10x scale, and your stack.
Collector contract:
Validate requests; return 400 for bad data.
Stamp server_received_at on every event.
Require a client-generated insert_id.
Convert properties to a JSON string.
Pack many events into each Firehose record.
Return 200 only after Firehose confirms the write; otherwise return 5xx or 429 so the SDK retries.
Never buffer events in memory before acknowledging, and shut down gracefully.
Decision 3: Firehose and the raw layer (locked)
Firehose converts to Parquet using a hybrid schema:
Core columns: insert_id, event_type, event_time, server_received_at, user, device and session IDs, platform, app_version.
JSON string columns: properties, user_properties, and an _extra catch-all.
Because every incoming field lands in some column, raw stays lossless and can be replayed.
Buffer: 10 minutes (possibly 5; decide during implementation). Note that format conversion requires a minimum 64 MB buffer size.
Raw partitioned by arrival time (dt=/hr=). It’s append-only, immutable once the hour ends, safe from bad client clocks, and needs no dynamic partitioning cost.
Clock-skew correction: the collector computes event_time + (server_received_at − client_upload_time) and also keeps the original timestamp.
Promoted columns: frequently queried properties get promoted to real columns over time.
Still to verify: whether Firehose format conversion works with several events packed into one record (this affects 5KB billing rounding).
Decision 4: Silver layer (proposed, awaiting your confirmation)
Deduplication: remove duplicates within each batch, then MERGE against only the silver partitions the batch touches, matching insert_id within ±1 day. No time limit on lookback, unlike Amplitude’s 7 days.
Partitioning: by day(event_time), with files sorted by event_type and then user_id.
Timestamp sanity: if a timestamp is in the future or earlier than the app’s launch, replace it with server_received_at and set time_corrected = true.
Cadence: hourly. Query raw for ~10-minute freshness and silver for clean data.
DynamoDB export: runs by arrival date and upserts by insert_id, so it’s incremental and safe to rerun. This needs an arrived_at column.
Engine: Athena MERGE, triggered by EventBridge and run with Step Functions; move to dbt once there are more than about 5 models.
This assumes Iceberg, which Decision 5 will validate.
Remaining decisions
Table format and catalog (Iceberg vs. Hive-style Glue tables), compaction, snapshot maintenance
Query layer (Athena workgroups, cost guardrails, rollups)
Schema governance (event schemas, evolution, PII)
Operations (monitoring, detecting data loss, cost tracking)
Confirm Decision 4, or adjust any part of it, and we’ll move on to Decision 5. I can also turn this recap into a doc you can come back to and share with the team.

I guess deduplication on insert_id and local batch is fine this way it will be faster and cheaper.
Partitioning what are the other ways, are there any other solutions which might be better because there will be particular days with less traffic and particular days with most traffic so I feel like it should not be uneven.
For Timestamp sanity future dates can be corrected to server_received_at

Explain this "Engine: Athena MERGE, triggered by EventBridge and run with Step Functions; move to dbt once there are more than about 5 models"

I don't want to move to next steps, I have lot of other doubts as well so I will clear all those and then I will go ahead for the next steps.

1. Deduplication: batch-only vs. MERGE
Batch-only is simpler, but it has two gaps you should know about before choosing it.

Gap 1: duplicates that straddle a batch boundary.
Most retries happen when Firehose wrote the events but the acknowledgement back to the app got lost, so the SDK sends them again a few seconds or minutes later. If that retry lands in the next hourly batch, batch-only deduplication never sees both copies. The volume is small, but correctness is never 100%.

Gap 2: the job itself stops being safe to retry. This is the bigger issue.
If Step Functions retries a failed or timed-out run, a plain INSERT writes the same hour twice. MERGE is idempotent: running it twice gives the same result. Pipelines fail and rerun constantly, so this matters more than the boundary case.

Cost reality: the MERGE only reads the insert_id column of the few date partitions a batch touches. Because Parquet is columnar, that’s megabytes per run, which costs fractions of a cent.

Option	Correctness	Safe to rerun	Needs Iceberg
Batch only + INSERT	Misses boundary duplicates	No	No
Batch + previous 1–2 hours of raw	Catches nearly all duplicates	No	No
Batch + MERGE on touched partitions	Effectively 100%	Yes	Yes
Recommendation: keep the MERGE, mainly for idempotency. If you choose batch-only, you’ll need a different way to make reruns safe. Batch-only would also make Iceberg optional, which affects Decision 5.

Principle: every batch job must be safe to run twice. Design for the retry, not the happy path.

2. Partitioning and uneven traffic
Uneven days aren’t a problem here. In a lakehouse (S3 plus Athena), a partition is just a folder that queries can skip. No server “owns” a partition, so a busy day doesn’t create a hotspot. A busy day just has more files, and compaction keeps file sizes even regardless of the day.

The transferable lesson: “partitioning” means two different things.

System	What partitioning is for	Does skew hurt?
DynamoDB, Kafka, Cassandra	Spreading load across nodes	Yes, it creates hot partitions
Athena, Iceberg, Hive	Pruning: skipping data a query doesn’t need	Mostly no; only file size matters
Alternatives:

Scheme	When it’s better
Daily (recommended)	Matches “last N days” queries, and around 365 partitions a year is easy for Iceberg to track
Monthly	Fine at Year 1 volume if files are sorted by event_time. Becomes coarse as volume grows.
Hourly	Too many tiny files at your scale
Bucket by user_id (hash into N buckets)	The way to get truly even distribution. It only helps per-user queries, and costs more files. Not needed now.
Safety valve: Iceberg supports partition evolution. You can switch from daily to hourly (or add buckets) later without rewriting old data, so this choice is reversible.

3. Timestamp sanity
Future dates → server_received_at: locked.

One addition worth considering: devices with a reset clock report dates like 1970. Those would create junk partitions. Apply the same rule to dates earlier than your app’s launch, or at least flag them.

4. The engine, explained
There are three pieces, each with one job:

Piece	Role	Analogy
Athena MERGE	The compute. You submit SQL; Athena reads S3, runs the upsert, and writes new Iceberg files. No servers, and you pay per TB scanned.	The worker
EventBridge Scheduler	Fires every hour	Cron, in the cloud
Step Functions	The workflow: run each step in order, wait, retry on failure, alert	The manager
What the Step Functions workflow does each hour:

Read the checkpoint: “last raw hour processed = 14:00.”
Run the Athena MERGE for the next unprocessed hour(s). Step Functions has a native Athena integration that waits for the query to finish, so there’s no polling code to write.
On success, advance the checkpoint.
On failure, retry with backoff, then alert. The idempotent MERGE is what makes this retry safe.
Why not a single Lambda? Lambda has a 15-minute limit, and you’d have to hand-write the polling, retries and state tracking. Step Functions gives you all of that, plus a visual history of every run, which makes debugging at 3am much easier.

dbt: a tool for managing SQL transformations as code.

Each table is defined as a SELECT in its own file.
dbt works out dependencies between tables and runs them in the right order.
It handles incremental merge logic for you.
It runs tests, such as “insert_id is unique” and “event_time is not null.”
It generates documentation and lineage.
Why wait for about 5 models? With one or two queries, dbt is extra tooling for little benefit. Once you have silver, daily rollups, the DynamoDB export and error summaries, the hard parts become ordering, testing and knowing what feeds what. That’s exactly what dbt solves. You’d run it as a Fargate task, triggered by the same scheduler.

How Amplitude-scale companies do it: the same split, usually Airflow or Dagster as the orchestrator with dbt or Spark for transformations. You’re using the serverless, low-cost version of the same architecture.

What’s your next doubt?

Batch + MERGE on touched partitions is fine
What happens when Feb has 29 days for daily partition if we are just counting days or are we doing it differently like Month + date. 
Timestamp sanity: Apply the same rule to dates earlier than your app’s launch

Before we get into Athena scan, I want to understand the warehouse how it is setup and what all things to take care of. When I was talking to collegue he mentioned something rds or some aws service for checking while thinking of warehouse setup.


Searched the web
Searched the web
1. February 29
Partitions are calendar dates, not a day counter. Iceberg’s day(event_time) transform calculates the day from the actual timestamp, so leap years are handled automatically and 2028-02-29 is simply another partition. Iceberg stores it internally as days since 1970, but you never write that logic yourself.

The question that actually matters is which time zone defines a “day.” Use UTC. Vancouver time shifts with daylight saving, which gives you 23- and 25-hour days, and on the fall-back night the same local hour happens twice. Convert to local time in queries when you need to, never in storage.

2. Timestamp sanity: locked
Both future dates and dates before the app’s launch are replaced with server_received_at, and the row is flagged time_corrected = true.

3. How the “warehouse” works
A traditional warehouse vs. a lakehouse
Traditional warehouse (Redshift, Snowflake, BigQuery): storage and compute come bundled in one product. You load data in and query it inside that product.

Lakehouse (what you’re building): the same capabilities, split into separate layers, each one swappable:

Layer	What it does	Your choice
Storage	Holds the bytes	S3 (Parquet files)
Table format	Tracks which files make up a table, plus schema, snapshots and ACID guarantees. This turns a folder of files into a table.	Iceberg
Catalog	A registry mapping table names to their current metadata. The phone book.	AWS Glue Data Catalog
Query engine	Reads the tables and runs SQL	Athena
Why split them: storage stays cheap S3, you pay for compute only when a query runs, and nothing locks you in. Redshift, Spark, Snowflake and DuckDB can all read the same Iceberg tables later.

How Amplitude does it: Amplitude’s engine, Nova, is a bundled, custom-built warehouse with storage, indexing and query in one place, tuned for sub-second interactive queries. You’re trading that speed for cost and openness.

What your colleague probably meant
Service	What it is	Fit for this project
RDS (Postgres/MySQL)	A transactional database: stores rows, runs on one node, uses disk storage	Poor fit. Billions of rows mean slow scans, and disk storage costs about 5x S3. Fine for a small reporting table, not for event storage.
Redshift (Serverless)	AWS’s bundled warehouse	Faster for heavy, repeated dashboard work, but more expensive and more to run. Keep it as a later option; it can query the same Iceberg tables.
Glue Data Catalog	The catalog layer	You need this. Likely what they meant by “checking” the warehouse setup.
S3 Tables	Managed Iceberg: S3 “table buckets” where AWS runs the table maintenance for you	A strong candidate for silver. More below.
What you need to take care of in a lakehouse
1. Table maintenance. This is the hidden work, and it’s where most self-built lakehouses rot. Every hourly MERGE adds small files and new snapshots, which pile up. Three jobs are needed:

Compaction: rewrite small files into large ones (around 256–512 MB) and apply the sort order.
Snapshot expiry: drop old table versions, keeping maybe 7 days for time travel.
Orphan file cleanup: delete files no snapshot references any more.
Who runs maintenance	How
You	Scheduled Athena OPTIMIZE and VACUUM via Step Functions
Glue table optimizer	Runs the same three jobs at roughly $0.44 per Glue DPU-hour
S3 Tables	Built in: compacts automatically, manages snapshots, and removes unreferenced files. Compaction prices were cut by up to 90% in July 2025.
One S3 Tables caveat: testing shows its compaction can lag by hours, so it won’t keep up with a minutes-level freshness requirement. That’s fine for you. Silver is hourly, and raw handles the minutes-fresh checks. The same testing found there’s no built-in dashboard showing compaction activity, so you’d add your own monitoring.

2. Registering the raw layer. The Firehose Parquet files need a Glue table. Use partition projection: Athena works out the dt/hr partitions from a pattern you define, so you don’t need crawlers or partition-add jobs.

3. Schema evolution. Promoted columns are added with ALTER TABLE ADD COLUMN, which in Iceberg is a metadata-only change.

4. Access control and PII. Use IAM, plus Lake Formation if you need column-level controls. Details are in Decision 7.

5. Storage tiering for lifetime retention. Never move Iceberg files to Glacier Flexible or Deep Archive. Athena can’t read them, and queries will break. Use Intelligent-Tiering or Glacier Instant Retrieval for old data.

6. Recovery. Iceberg snapshots handle “undo a bad MERGE.” The raw layer is your full rebuild path, so protect it with S3 versioning and deny-delete policies.

Where this is heading (not locking anything yet)
Raw: a regular S3 bucket, written by Firehose, registered in Glue with partition projection.
Silver: Iceberg tables in S3 Tables. You pay a small premium so you never build the compaction, snapshot and cleanup jobs yourself.
Catalog: Glue. Engine: Athena.
Principle: in a lakehouse, writing data is the easy part. Ongoing maintenance is what decides whether it’s still fast and cheap after a year. Choose who owns that maintenance before you choose features.

What’s your next doubt?

Sources:

Amazon S3 Tables reduce compaction costs by up to 90%
AWS S3 Tables: After the 10x Priceberg Plunge (Onehouse)
The Truth About Amazon S3 Tables in 2026
Amazon S3 Tables vs the Glue Optimizer
Do all UTC.
So daily partition means next year will be new partitions for each day? Or are we moving the year old files into glacier instant for backup?
What is silver?
What is catalogue and what glue holds?

1. UTC: locked
2. Daily partitions over time
Yes, every day gets a new partition, indefinitely. 2027-01-01, 2027-01-02, and so on. You’ll accumulate about 365 a year, or around 3,650 after 10 years. Iceberg handles that easily, because it tracks partitions in its own metadata files rather than listing folders.

Moving old files to Glacier is a separate concept: storage tiering. It doesn’t touch partitioning at all.

What it controls	Example
Partitioning	Which files a query can skip	dt=2026-03-15
Storage class	How much S3 charges to keep and read each file	Standard → Infrequent Access → Glacier Instant Retrieval
Old files stay in the same table, at the same location. Only their storage class changes, so queries still work.
This is not a backup. Tiered files are still your primary data, just stored more cheaply. Backup is a separate concern: S3 versioning, cross-region replication, and protecting raw.
Recommendation: S3 Intelligent-Tiering. It moves files automatically based on how often they’re accessed, with no retrieval fees. With large compacted files, its small per-object monitoring fee is negligible.
Cost reality: Year 1 is about 150 GB, roughly $3.50/month. Tiering saves pennies at first and only matters after years at 10x volume. Set it once and forget it.
To verify: which storage classes and lifecycle options S3 Tables supports. Table buckets manage storage differently from regular buckets.
3. What is “silver”?
These are layer names from the medallion architecture, a common data-lake convention:

Layer	What it holds	In your design
Bronze (raw)	Data exactly as received, never modified	Firehose Parquet, partitioned by arrival hour
Silver (clean)	Deduplicated, validated, standardized data	The Iceberg events table: MERGE on insert_id, corrected timestamps, partitioned by event date
Gold (serving)	Aggregated or purpose-built tables	Daily rollups, the DynamoDB export, dashboard tables
Each layer is rebuilt from the one before it. A bug in silver means you rerun from bronze, with no data lost.

How Amplitude does it: they have the same three stages, under different names. Raw ingest goes to processed events, which feed precomputed indexes and chart caches.

4. What a catalog is, and what Glue holds
The problem it solves: in S3, Parquet files are just files. When you run SELECT * FROM events_silver, Athena has to know which files make up that table, what the columns are, and how they’re partitioned. The catalog answers that. It’s like a library’s card catalog: it tells you where the books are, but it doesn’t hold any books.

What Glue Data Catalog stores (metadata only, never your data):

Databases (namespaces), for example analytics.
Tables: the name, columns and types, S3 location, file format, and partition keys.
Partitions: for Hive-style tables, like your raw table. With partition projection there’s just a pattern instead of a list.
For Iceberg tables: a pointer to the table’s current metadata file, plus table properties.
How Iceberg uses that pointer. This is the key concept:

Glue → metadata.json (schema, snapshots) → manifest list → manifests → Parquet data files
Every write (a MERGE, a compaction) creates new metadata. The commit then atomically swaps the pointer in the catalog to the new metadata file. A reader sees either the old version or the new one, never something half-written. That single atomic swap is where Iceberg’s ACID guarantees, time travel and safe concurrent writes come from.

S3 Tables: table buckets have a built-in Iceberg catalog that integrates with Glue. Athena sees those tables alongside your raw table in the same catalog.

The transferable pattern: keep large immutable data files, plus a small mutable pointer that you swap atomically. Git uses the same design (a branch ref pointing to immutable commits), and so do blue/green deployments and copy-on-write data structures.

What’s next on your list?

When we are talking about compacting, there is one thing that S3 table does what is that? I though we are just running a job to combine all the hourly files into 1 single file of max 256mb maybe or something for the whole day.

Your mental model is right for compaction itself: combine many small files into fewer large ones, targeting a file size (around 256–512 MB). In Iceberg, though, compaction is only one of three jobs, and doing it alone doesn’t finish the work. S3 Tables runs all three.

Why it isn’t just “merge the files”
You can’t just run a script that concatenates Parquet files in S3. The table only knows about files that are listed in its metadata, so every change has to be committed as a new snapshot (remember the pointer swap). That has knock-on effects.

The three jobs, over one day
Hour 1–24:  24 MERGEs → 24 small data files + delete files
            (each MERGE = a new snapshot)

Compaction: Rewrite into 1 large sorted file → commit snapshot #25
            ⚠ The 24 small files still exist: snapshots 1–24 reference them (time travel)

Snapshot    After 7 days, drop snapshots 1–24
expiry:     → the 24 small files are no longer referenced by any snapshot

Orphan      Delete files nothing references
cleanup:    (including leftovers from failed writes) → storage actually shrinks
The counterintuitive part: compaction on its own increases storage, because the old and new copies both exist. Space is only reclaimed after snapshot expiry and cleanup. Skip those two jobs and your bucket grows forever.

Three more things compaction does that you might not expect
It applies delete files. Athena’s Iceberg MERGE doesn’t rewrite whole data files. It writes small delete files that record “row X in file Y is replaced” (called merge-on-read). Every query has to read those and filter rows out, so they slow reads down as they pile up. Compaction folds them into clean data files.
It enforces sort order. Hourly MERGEs write files that are roughly unsorted. Compaction is where your event_type, user_id sort actually happens, and that’s what makes Parquet’s min/max statistics useful for skipping data.
It targets file size, not one file per day.
Year 1: a day is about 50–150 MB, so roughly one file per day.
At 10x: about 1.5 GB per day, so around six files of 256 MB each.
The hidden hard part: knowing which partitions to compact
Late mobile events keep adding small files to old days. A self-built job has to work out which partitions changed since it last ran, using Iceberg snapshot summaries or tracking by arrival time. Otherwise it either misses those partitions or recompacts everything.

S3 Tables watches the table and compacts only the partitions that need it. It also handles snapshot expiry and orphan cleanup. That’s the premium you’d be paying for: not the file merging itself, but the scheduling, change detection and cleanup around it.

How Amplitude does it: Nova handles this internally (background merging of segments, like most columnar stores). The same pattern appears in LSM-tree databases like Cassandra and RocksDB: write small and fast, then merge in the background. It’s a universal trade-off for systems that do a lot of writes.

Transferable principle: in any system with immutable files plus versioned metadata (Iceberg, Delta Lake, LSM trees, Git), cleanup has two steps. First make the old data unreferenced, then delete it. If you forget the second step, storage leaks quietly.

Next doubt?

what if I need to query per user events

Good catch. The sort order I proposed (event_type, then user_id) is weak for per-user queries.

Why
Parquet skips data using min/max statistics for each block of rows (a “row group”). With files sorted by event_type first, each block covers one narrow range of event types but a wide range of users. A query like WHERE user_id = 'u123' can’t rule much out, so Athena reads most of every file in the date range.

Rule: a sort order prunes well on the first column, and only partially on the columns after it.

Is it a problem today? Not yet.
Scenario	Data scanned	Cost per query
One user, last 30 days, Year 1 (~100 MB/day)	~3 GB	~$0.015
One user, full history after 1 year	~150 GB	~$0.75
One user, full history after a few years at 10x	~several TB	$5–20+
Cost scales with data volume × how often you query. Fix it early, because changing the layout is cheap now.

Options
Option	Per-user queries	Event-type queries	Cost / complexity
Sort by user_id first	Excellent	Weak	Free (one compaction setting)
Z-order on (user_id, event_type)	Good	Good	Free with S3 Tables, which supports z-order compaction
Bloom filter on user_id	Excellent for exact matches	No effect	Small file-size overhead. Check that Athena reads it.
Bucket partitions by user_id	Excellent	No effect	Too many small files at Year 1 volume, so defer
Per-user index in a separate store (DynamoDB keyed by user_id + time)	Sub-second	n/a	A second copy of the data to maintain
What z-order does: it interleaves the bits of both columns, so rows that are close on either column end up close together in the file. You lose a bit of best-case speed on each column and gain balanced skipping on both.

What a bloom filter does: each block stores a compact summary that can answer “is u123 definitely not in here?” That’s ideal for looking up exact values of high-cardinality IDs, where min/max ranges tell you almost nothing.

Recommendation
Z-order on (user_id, event_type) during compaction, so both access patterns get reasonable skipping.
Bloom filter on user_id (and maybe device_id) for exact lookups.
Always include a date range in queries. Make it a team convention, or enforce it with a parameterized query or view.
Add a per-user index only if a real need appears. For example, a support tool or in-app feature needing sub-second user timelines. That becomes a gold-layer table, not a change to silver.
How Amplitude does it: their user lookup and activity-stream features need a different layout from funnel and aggregate queries. At their scale, that typically means a separate per-user index rather than one table serving both. This is the same principle in action.

Principle: one physical layout can’t be optimal for every access pattern. Choose based on the most common query. Use z-order and bloom filters to make other patterns acceptable, and when an access pattern becomes critical, give it its own copy with the right layout. That’s what the gold layer is for.

Which will be more common for your developers: per-user debugging (“what did user X do?”) or event-level analysis (“how often does error Y fire?”)? That decides whether z-order is enough or user_id-first is better.

What is Z-order?
What is Bloom Filter?
I want to keep event_type primary but allow user_id(s) for filter. Trying to keep things similar to Amplitude for query. Or might solve it later with proper warehouse.

Z-order, the intuition
Picture your data on a 2D grid, with event_type on one axis and user_id on the other. A file is divided into blocks (row groups), and each block covers some region of that grid.

Sorting by event_type, then user_id: each block covers a thin horizontal strip. That’s one event type, but every user.

event ↓  users →
  A  [■■■■■■■■■■■■]  ← block 1: event A, all users
  B  [■■■■■■■■■■■■]  ← block 2: event B, all users
A query for a single user can’t skip any strip, because every strip contains every user.

Z-order: each block covers a small square, meaning a few event types and a few users.

  A  [■■■][■■■]
  B  [■■■][■■■]   ← each block = a small range of both
Now a filter on either column can skip most of the squares.

How it works: take the binary value of each column and interleave the bits. For example, user 10 and event 11 interleave to 1101. Rows that are close on both values end up with close codes, so sorting by that code keeps them together. The path it traces through the grid looks like a repeating “Z”, hence the name. It’s also called a Morton curve.

The trade-off: each column skips a bit less well than if it were the only sort key, but both columns skip reasonably well.

Bloom filter, the intuition
A small summary attached to each block that answers one question: “Is value X definitely not in this block?”

How it works:

Start with an array of bits, all set to 0.
To add u123, hash it with k hash functions. Each hash points to a position in the array; set those bits to 1.
To check for u999, hash it the same way. If any of those positions is 0, the value is definitely absent, so skip the block. If all of them are 1, it’s maybe present, so read the block.
Properties:

No false negatives. You never skip a block that really contains the value.
Occasional false positives, which just means reading a block unnecessarily. The rate is tunable: about 10 bits per value gives roughly a 1% false-positive rate.
Only works for exact matches (= and IN). It doesn’t help with ranges or LIKE.
Why it fits user_id: user IDs are high-cardinality and fairly random, so min/max ranges tell you almost nothing, but “definitely not here?” is exactly the right question.

Where else you’ll see it: Cassandra and RocksDB use it to avoid disk reads, CDNs use it to decide what to cache, and databases use it to filter joins. It’s one of the most widely reused ideas in data systems.

Your choice: event_type primary with user_id filtering
That maps cleanly onto two separate mechanisms, so you don’t need z-order:

Mechanism	Handles
Sort: event_type, then user_id	WHERE event_type = X prunes strongly. event_type = X AND user_id = Y prunes even better, because users are sorted inside each event’s range.
Bloom filter on user_id (and device_id)	WHERE user_id IN (...) with no event filter. Blocks that don’t contain the user get skipped.
What to expect: a query for one user across all events still reads a few blocks per day, because that user appears in each event type’s range. But it skips most of the data.

To verify during implementation: confirm Athena actually uses Parquet bloom filters on your Iceberg or S3 Tables setup. Run the same query with and without the filter and compare the “data scanned” figure.

This matches Amplitude’s model: Amplitude queries are event-first. You choose an event, then filter by user or property. Your layout follows the same mental model.

On “solve it later with a proper warehouse”
This setup is the warehouse: S3, Iceberg, Glue and Athena. If per-user lookups later become heavy or latency-sensitive, the next step isn’t replacing the warehouse. It’s one of these:

Add a gold-layer per-user table (DynamoDB or an Iceberg table sorted by user_id), or
Point Redshift at the same Iceberg tables for heavier workloads.
Both work because the storage is open. That’s the payoff from separating the layers.

Locked for silver: sort by event_type, then user_id, with bloom filters on user_id and device_id.

Next doubt?

I meant in future we can "Point Redshift at the same Iceberg tables for heavier workloads" by I mean switching the warehouse or better warehouse setup.

Got it. You meant replacing or upgrading the warehouse itself later. The main design goal now is to make that switch cheap.

What carries over, and what doesn’t
Layer	Carries over?	Why
Data files (Parquet)	✅ Fully	An open format every engine reads
Table format (Iceberg)	✅ Fully	Redshift, Snowflake, BigQuery, Databricks, ClickHouse, Trino, StarRocks and DuckDB can all read Iceberg tables
Catalog (Glue / S3 Tables)	✅ Mostly	Both expose the standard Iceberg REST catalog interface, so other engines can connect to it
SQL	⚠️ Partly	Athena uses Trino’s SQL dialect. Standard SQL carries over; engine-specific functions need rewriting.
Orchestration (Step Functions)	⚠️ Rework	It’s AWS-specific glue, although the logic behind it carries over
The key point: the expensive, heavy part, years of data, is stored in an open format. Only the cheap, replaceable part (compute) is tied to a vendor.

Three ways to switch later, from cheapest to most expensive
Swap the engine, keep the storage. Point Redshift, Snowflake or Trino at the same Iceberg tables. No data moves; it’s a configuration change.
Add a serving engine for the hot path. Keep the lake as the source of truth and copy only gold tables into something fast (ClickHouse, Redshift) for sub-second dashboards.
Move fully into a bundled warehouse. Load everything into native Snowflake or Redshift tables. Fastest queries, but a full data copy and the most lock-in.
When you’d actually switch
Track these from day one so the decision is based on data, not instinct:

Athena cost keeps rising, because queries are frequent and scan a lot of data.
Latency: dashboards need sub-second response, and Athena takes seconds.
Concurrency: many people running queries at the same time hit Athena’s limits on concurrent queries.
Joins with other company data (orders, billing) that already lives in another warehouse.
Decisions now that keep the switch cheap
Use Iceberg for silver and gold. You’ve already decided this; it’s the single most important portability choice.
Keep transformations in dbt once you adopt it. dbt supports many engines through adapters, so your models move with you.
Write standard SQL in silver. Put engine-specific functions in views, which are cheap to rewrite.
Don’t build on Athena-only features in core tables.
Log query cost and latency per query from the start.
How Amplitude does it
Amplitude’s own direction shows the same principle. Alongside its bundled engine, it offers a warehouse-native option that runs analytics directly on the customer’s warehouse (Snowflake). The industry is moving toward “data stays in open storage you own, and engines plug into it.”

Principle: storage has gravity, and compute is replaceable. Make the hard-to-move part open, and keep the easy-to-move part flexible.

Next doubt?

Let's do this for now: sort by event_type, then user_id, with bloom filters on user_id

Locked: silver is sorted by event_type, then user_id, with a bloom filter on user_id.

The device_id filter is dropped for now. That’s easy to undo: a bloom filter is just a table write setting, so adding it later only affects files written or compacted from then on. Old files gain it the next time compaction rewrites them.

What this gives you:

event_type = X → skips most of the data
event_type = X AND user_id = Y → skips almost everything
user_id = Y alone → skips most blocks, thanks to the bloom filter
To check during implementation: compare “data scanned” for a user-only query with and without the bloom filter, to confirm Athena actually uses it.

Ready for the next doubt, or shall I update the recap first?

yes lets move to next

Before Decision 5, three parts of Decision 4 are still unconfirmed. I’ll treat them as accepted unless you object:

Silver runs hourly; raw serves checks that need data from the last few minutes.
The DynamoDB export runs by arrival date and upserts by insert_id.
The engine is Athena MERGE + Step Functions + EventBridge, with dbt added once there are about 5 or more models.
Decision 5: Table format, catalog and storage
We’ve already covered most of this, so here’s the proposal plus the two remaining questions.

How Amplitude does it
Kafka holds recent raw events for replay. Nova is a bundled store that handles its own merging. Long-term raw archives typically live in object storage, so the company can always rebuild.

5a. Silver: S3 Tables or self-managed Iceberg?
Option	You run	Cost	Risk
Self-managed Iceberg (regular bucket)	Compaction, snapshot expiry and orphan cleanup jobs, plus working out which partitions changed	Lowest raw cost	Maintenance gets skipped and the table slowly degrades
Glue table optimizer	Configuration only	Glue compute charges	Medium
S3 Tables	Configuration only	A small premium on storage and compaction	Less visibility into maintenance, so add your own monitoring
Recommendation: S3 Tables. At your volume the premium is a few dollars a month. It removes an entire category of operational work, including the change detection for partitions that late events touch.

5b. Catalog
Glue Data Catalog. The raw table goes in Glue directly, and S3 Tables integrates with Glue, so Athena sees both in one place.

5c. Registering the raw table
Register raw as a Hive-style Glue table with partition projection: Athena works out the dt/hr partitions from a pattern. No crawlers and no partition-add jobs.

5d. Snapshot retention
Keep 7 days of snapshots. That gives you a week of time travel to undo a bad MERGE. Silver can always be rebuilt from raw, so a longer history isn’t needed.

5e. Raw lifecycle (new idea)
Raw has two jobs:

Recent: answer checks like “did my event fire?” (the last few days).
Long-term: be the replay source for disasters.
The second job almost never involves querying, so raw can sit in the cheapest storage tier:

Raw age	Storage class	Queryable?
0–30 days	S3 Standard	✅
30+ days	Glacier Deep Archive (about 25x cheaper than Standard)	❌ Must be restored first. Fine for rare disaster replays.
Silver uses Intelligent-Tiering, which is always queryable.

Raw protection: turn on S3 versioning, deny deletes, and allow only Firehose to write.

Principle: tier data by its job, not just its age. Data kept only for recovery doesn’t need to be queryable quickly.

To lock Decision 5, confirm:
S3 Tables for silver (and gold)?
Raw lifecycle: Standard for 30 days, then Glacier Deep Archive. Is 30 days the right window for direct raw queries?
Yes all these Decision 4 are confirmed.

Let's go with S3 Tables

all these are fine let's move to next

Decisions 4 and 5 are locked.

Decision 6: Query layer (Athena, cost guardrails, dashboards)
Why this is the main cost decision: storage and ingestion are cheap. With Athena, every query has a price, at $5 per TB scanned. You already expect developers to be less careful about adding events, and they’ll be the same with queries.

How Amplitude does it
Amplitude precomputes and caches results heavily, and query cost is hidden inside the subscription, so users never think about it. You don’t get that luxury, so cost guardrails have to be built in from day one.

The risk, in numbers
Take one dashboard with 10 panels, refreshing every 5 minutes, where each refresh reads 30 days of silver (about 3 GB):

10 × 288 refreshes/day × 3 GB ≈ 8.6 TB/day ≈ $1,300/month, for one dashboard.

Point the same dashboard at a pre-aggregated table (kilobytes per query) and the cost drops to almost nothing. That one decision is worth more than every other optimization combined.

6a. Workgroups (Athena’s unit for isolating users and enforcing limits)
Workgroup	Who uses it	Per-query scan limit
adhoc	Developers	~100 GB (an accidental full-history scan fails instead of costing money)
pipeline	MERGE and export jobs	Higher, or none
dashboards	BI tool	Low; should only ever read gold tables
Enforce workgroup settings, so a client can’t override the limits.
Add CloudWatch alarms on daily data scanned for each workgroup.
Query results go to a bucket with a 7-day expiry rule.
6b. Make the cheap path the default
Create an events_recent view (last 30 days) as the documented entry point. Querying full history should be a deliberate choice.
Keep a library of saved queries: user timeline, event counts, error trends. Developers lose Amplitude’s point-and-click UI, and a cookbook fills the gap.
Add views that pull common properties out of the JSON into columns, so developers aren’t writing json_extract everywhere.
6c. Gold rollups for dashboards
Daily aggregates: count by event_type × day × platform × app_version, plus whatever key dimensions dashboards need.
Built incrementally right after each silver run, as one more step in the same workflow.
Dashboards read only gold tables. Turn on Athena’s query result reuse so repeated identical queries are answered from cache.
6d. Dashboard tool
Tool	Behaviour	Fit
Grafana + Athena plugin	Every refresh runs a query	Good if engineering already uses it. Safe as long as it reads gold.
QuickSight with SPICE	Imports data on a schedule; refreshes don’t hit Athena	Cheapest per refresh, but you pay per user
Metabase (self-hosted)	Runs queries, with built-in caching	One more service to operate
Recommendation: whichever one your engineers already use (probably Grafana), with the rule that dashboards read gold only.

Principle: with pay-per-query engines, cost scales with how often you read × how much each read scans. Cut both: pre-aggregate the hot paths, and put limits on ad-hoc access.

To lock Decision 6, confirm:
Three workgroups with enforced scan limits and alarms?
events_recent view as the default entry point, plus a saved-query library?
Gold daily rollups, with dashboards reading gold only?
Which dashboard tool does engineering use today?
explain me more in depth before making this decision. We are using everything from aws tools mostly.'


Searched the web
Searched the web
Here’s the full picture, all in AWS terms.

1. How Athena runs and bills a query
You pay for bytes read from S3 after every layer of skipping. Each layer you designed earlier cuts that number further.

Step	What Athena does	What it skips	Where it gets the information
1. Partition pruning	Keeps only the date partitions in your WHERE clause	Other days	Iceberg metadata, via Glue / S3 Tables
2. File pruning	Drops files whose min/max values can’t match	Files for other event types	Iceberg manifests (per-file statistics)
3. Row-group pruning	Drops blocks inside each file	Blocks without that event or user	Parquet footers: min/max and bloom filters
4. Column pruning	Reads only the columns you SELECT	properties JSON, if you don’t select it	Parquet’s column-by-column layout
Example: “count app_crash for user X over the last 7 days,” at Year 1 volume:

7 days ≈ 700 MB → files for app_crash only ≈ 30 MB → blocks containing the user ≈ 5 MB → just the columns needed ≈ 1 MB

That query costs a fraction of a cent. SELECT * with no date filter undoes all of it.

Billing details:

About $5 per TB scanned, with a 10 MB minimum charged per query.
Failed or cancelled queries are still billed for whatever they scanned.
DDL statements (like CREATE TABLE) are free.
Hidden cost: every Athena query also issues S3 read requests, billed by S3 at $0.40 per million, and they don’t appear on Athena’s line in Cost Explorer. Lots of small files means lots of reads, which is another reason compaction matters.
How Amplitude does it: Amplitude’s engine (Nova) does the same kinds of skipping, but the cost is spread across a flat subscription. Athena shows you the price of every query, which is why guardrails matter more for you.

2. Workgroups: how they work
A workgroup is Athena’s unit for isolating users, enforcing settings and tracking cost. Each workgroup has:

Setting	What it does
Per-query data limit	Cancels a query once it scans past the limit. You pay only up to the limit.
Workgroup-wide usage alerts	“More than X TB scanned per hour or day” sends a CloudWatch alarm via SNS. It can trigger a Lambda that disables the workgroup, giving you a hard budget stop.
Enforced settings	Clients can’t override the result location, encryption or limits
Result location	An S3 prefix with a lifecycle rule (delete after 7 days)
IAM scoping	Policies decide who can use which workgroup
Cost allocation tags	Spending broken down per workgroup in Cost Explorer
Saved queries	A shared library of queries for the workgroup
Proposed setup:

Workgroup	Users	Per-query limit	Reads
adhoc	Developers (IAM Identity Center role)	~100 GB	Raw, silver, gold
pipeline	Step Functions role	Higher	Raw → writes silver and gold
dashboards	BI service role	~1 GB	Gold only (enforced through IAM / Lake Formation)
Later option: capacity reservations. Instead of paying per TB, you reserve compute at a fixed hourly rate, with a 4-DPU minimum and per-minute billing. Worth it only when usage is heavy and predictable. Not needed now.

3. Query result reuse
When the same query runs again within a maximum age you set, Athena returns the cached result without scanning anything. That’s useful for dashboards where many people open the same view.

To verify during implementation: whether result reuse supports Iceberg and S3 Tables. If it doesn’t, the BI tool’s own caching does this job instead (next section).

4. Gold layer, in more depth
What goes in it: tables shaped to fit exactly one use.

daily_event_counts: event_type × day × platform × app_version → counts, unique users
daily_errors: error codes and app versions over time
The DynamoDB export input (already decided)
How it’s built: as one more step in the hourly workflow, right after the silver MERGE.

Late events matter here too: a late event changes an old day’s counts. So the gold step recomputes only the dates the silver batch touched, using the same pattern as silver. If it only recomputed “today,” the counts for past days would drift.

Size: thousands of rows per day, kilobytes in total. Every dashboard query hits the 10 MB minimum, which costs effectively nothing.

5. Dashboard options in AWS
Amazon Quick Sight (formerly QuickSight, now part of Amazon Quick)	Amazon Managed Grafana
How it reads data	Either direct query (each view hits Athena) or a SPICE import (an in-memory copy, refreshed on a schedule)	Every panel refresh queries Athena through a plugin
Cost behaviour	With SPICE, dashboard views cost zero Athena. You only pay when the data refreshes.	Every refresh is a query. Fine if it only reads gold.
Pricing	Per user, or bulk reader-session pricing. Each Author includes 10 GB of SPICE; Readers have no SPICE allocation of their own.	Per active user
Strengths	Business-style dashboards, filtering, sharing, AI features	Engineering dashboards next to CloudWatch metrics and alarms, which engineers already use
Weakness	Separate user management, plus licence costs	Less suited to exploring analytics data
How SPICE fits your workflow: schedule a SPICE refresh hourly, after the gold step finishes. That’s 24 small gold queries a day, no matter how many people view the dashboard. Data freshness matches silver.

How to choose:

Engineering dashboards next to infrastructure metrics → Managed Grafana, reading gold only.
Dashboards shared with product or leadership, or with many viewers → Quick Sight with SPICE.
For a mostly-developer audience, Grafana is usually the more natural fit, if you already run it.
6. How developers will access the data
Athena console, using the workgroup’s saved-query library.
JDBC/ODBC drivers for DBeaver or DataGrip, through the same IAM role, so the workgroup limits still apply.
Optionally, SageMaker Unified Studio notebooks for deeper analysis.
Default entry point: an events_recent view (last 30 days), plus views that pull common properties out of the JSON into columns.
Principle: cost = how often you read × how much each read scans. Gold and caching shrink the first factor, layout and pruning shrink the second, and workgroups cap whatever slips through. Each layer catches what the one before misses (defense in depth).

To lock Decision 6, confirm:
Three workgroups (adhoc, pipeline, dashboards) with enforced limits, alarms and a budget-stop Lambda?
Gold tables rebuilt for the dates each batch touched, with dashboards reading gold only?
Do you run Grafana today, or should I compare Managed Grafana and Quick Sight against your expected number of dashboard viewers?
Sources:

Amazon Athena Pricing in 2026 (Cloudburn)
Amazon Quick Sight pricing
Amazon Quick Sight FAQs
I don't think we have dashboards for viewing data in this setup. We will be using mostly recently added data to basically do some engineering analysis and keep moving to the next. These events are not for product so thinking of a typical analytics service is not right I guess.

That changes things. This is engineering analysis of recent data, which is closer to observability than to product analytics. The usual analytics-service setup (dashboards, rollups, BI tools) adds cost and complexity you won’t use. Good catch.

Why the lake is still the right choice: pure observability tools like CloudWatch Logs Insights or OpenSearch are built for search over a short window. You still want lifetime retention, SQL across months when you need it, and the daily DynamoDB export. The lake covers those, so the design holds and only the query layer gets simpler.

Revised Decision 6 (simplified)
Before	Now
3 workgroups	2: adhoc (developers) and pipeline (jobs)
Gold rollups for dashboards	Removed. Gold holds only the DynamoDB export input
BI tool (Grafana / Quick Sight)	None. Developers use the Athena console or a SQL client
100 GB per-query limit	Lower, about 20–50 GB. Recent-data queries should never need more, so a bigger scan is almost certainly a mistake
Keep these:

events_recent view over silver as the default entry point, plus views that pull common properties out of the JSON.
An events_live view over raw covering the last 24 hours, for “did it fire?” checks with about 10 minutes of delay. It isn’t deduplicated, which is fine for engineering checks. Silver is the deduplicated truth.
A saved-query library in the workgroup: user timeline, event counts, error trends.
Workgroup alarms plus a budget-stop Lambda. This is still the safety net against a runaway query.
Rule for adding gold later: when the same heavy query starts running regularly (daily, by several people, or in a script), turn it into a gold table at that point. Build gold from repeated demand, not in advance.

How Amplitude does it: Amplitude is built for repeated, interactive product questions, which is why it precomputes so much. Your workload is “query once, learn something, move on,” so precomputing would cost money for nothing. Matching the design to the actual access pattern is the same idea as Decision 1, applied again.

To lock Decision 6, confirm:
Two workgroups with a scan limit of about 20–50 GB, alarms, and a budget stop?
No gold beyond the DynamoDB export for now, with the “build on repeated demand” rule?
What window should events_recent cover: 7 days or 30 days? This decides how much a default query scans.
I guess this is fine now. events_recent should cover 7 days

Decision 6 is locked: two workgroups with a scan limit of about 20–50 GB, alarms and a budget stop; gold only for the DynamoDB export; events_recent covers 7 days; events_live covers raw for the last 24 hours.

Decision 7: Schema governance
This is about keeping data usable as dozens of developers add events freely. It covers definitions, validation, change rules, volume control, and personal data (PII).

How Amplitude does it
Tracking plans (Amplitude Data) define each event and its properties.
Ampli generates typed SDK methods from that plan.
Events not in the plan can be allowed, flagged or blocked.
Specific properties can be dropped or blocked.
A User Privacy API handles deletion requests.
Devices sending too many events too fast get throttled.
7a. One source of truth for event definitions
Keep one schema registry file per event, in a repo (JSON Schema or TypeScript). Each one lists:
name and owner team
description
properties, with their types and which are required
a PII flag
Generate the InternalEvent types from it (already decided in Decision 2), so the compiler enforces the definitions.
The collector loads the same registry to validate incoming events.
This is your version of Amplitude’s tracking plan plus Ampli. The registry is also exactly what AI coding tools should read.

7b. Where validation happens: never drop events at the collector
Layer	Check	When it fails
Compile time	Typed methods	The build fails
Collector	Compare against the registry	Accept the event, tag it _unregistered or _invalid, and count it in metrics
Silver	Quality checks	Alert the event’s owner
Why accept bad events: old mobile app versions stay in use for months and can’t be fixed. If the collector rejected their events, data would be lost permanently. Flagging them keeps the data and surfaces the problem. Amplitude’s “flag unplanned events” mode makes the same choice.

7c. Rules for changing a schema
Only add, never change. New properties are fine anytime.
Never change a property’s type. For example, duration going from a string to a number breaks every query that uses it. Use a new name instead, such as duration_ms.
Renaming means adding a new property and deprecating the old one. Keep writing both during the transition.
For breaking changes, create a new event (checkout_error_v2) rather than changing what an existing event means.
Promoting a property to a real column (Decision 3) is a deliberate step: add the column, then backfill it from the properties JSON.
The principle: old data and old app versions never go away, so every change must be backward compatible. Kafka schema registries, Protobuf and API versioning all follow the same rule.

7d. Volume control (your “less careful developers” risk)
The real danger on mobile is a bug that fires an event in a loop. One release can multiply your volume 100x overnight.

Track counts per event, per hour, as part of the pipeline. Alert when an event jumps more than about 5x compared with the same hour last week, and notify the event’s owner.
Throttle individual devices at the collector: something like more than 50 events per second from one device gets a 429 response. This is what Amplitude does. It needs shared state; ElastiCache Redis is the obvious choice given your Redis experience.
Recommendation: start with volume alerts now. Add per-device throttling once alerts show a real incident. It adds a stateful dependency to a collector that’s currently stateless.
7e. PII and deletion requests
This is the hardest part, because of lifetime retention.

Policy: no direct PII in events (names, emails, phone numbers, precise location). Use your internal, pseudonymous user_id.
IP addresses: the collector should either drop them or turn them into a coarse location and then drop them. Raw IPs should never be stored.
Deletion requests:
Silver: run DELETE WHERE user_id = X (an Iceberg row-level delete). Remember the compaction lesson: the data only physically disappears after compaction, snapshot expiry and orphan cleanup run.
Raw: rewriting files in Glacier Deep Archive is expensive and slow. Two options:
PII-free events plus pseudonymization: once a user is deleted from your main database, their user_id in raw no longer links to a person. Simple, but whether that’s legally enough depends on your obligations.
Crypto-shredding: encrypt each user’s identifying fields with a per-user key, and delete the key to make that data unreadable. Strong, but complex.
Recommendation: PII-free events, deletes in silver, and pseudonymization for raw. Confirm with legal. You operate under Canadian privacy law (PIPEDA, BC’s PIPA, and Quebec’s Law 25 if you have Quebec users). I’m not a lawyer, so treat this as engineering framing, not legal advice.
To lock Decision 7, confirm:
A schema registry in the repo that generates the types and drives collector validation?
Accept and flag invalid events, never drop them?
Additive-only change rules?
Volume alerts now, per-device throttling later?
PII-free events and deletes in silver, with the approach for raw confirmed by legal?
For Gold if needed in future can you give me comparison in a table with costing and usage

These are the options for gold tables, if and when you need them. Figures are approximate, at Year 1 volume; check them in the AWS Pricing Calculator before committing.

Gold layer options
Option	Best for	Query speed	Freshness	How you pay	Est. monthly cost	Ops effort
Athena view (not materialized)	Convenience: hiding JSON extraction, standard filters	Seconds	Same as silver	Each query rescans silver (~$0.0035 for 7 days)	~$0, plus per-query cost	None
Iceberg gold table (S3 Tables + Athena)	Repeated heavy SQL: daily error trends, counts by app version	Seconds	Hourly, built after each silver run	Build: scan the touched silver dates. Query: hits the 10 MB minimum.	~$2–5 to build, cents for storage	Low (one extra workflow step)
DynamoDB	Key lookups from apps or tools: a user timeline API, support tooling (you already export here)	Single-digit milliseconds	Hourly or daily	On-demand writes and reads, plus storage (~$0.25/GB)	~$10–30 for about 1M upserts a day	Low
Quick Sight SPICE	Dashboards with many viewers	Sub-second	Scheduled refresh	Per-user licences; 10 GB SPICE per Author included	Licence-driven (~$20–40+ per author)	Low to medium
Redshift Serverless	High-concurrency dashboards, complex joins with other company data	Sub-second to seconds	Hourly	Compute-hours while queries run	~$100s+ if used daily	Medium
ElastiCache (Redis)	Real-time counters and limits (e.g., per-device throttling)	Sub-millisecond	Real-time	Always-on node-hours	~$15–50 for a small node	Medium (a stateful service)
How to pick
Trigger	Choose
The same complicated SQL is being copy-pasted	Athena view
The same heavy query runs daily or in scripts	Iceberg gold table
An app or tool needs per-user or per-key answers in milliseconds	DynamoDB
Many non-engineers start viewing dashboards	Quick Sight SPICE
Athena latency or concurrency becomes the bottleneck	Redshift Serverless on the same Iceberg tables
You need real-time counts or limits	ElastiCache
Default path as needs grow: view → Iceberg gold table → DynamoDB (for serving). Each step adds cost only when a real usage pattern justifies it.

Principle: choose the gold layer by who consumes the data and how: SQL users want tables, applications want key lookups, viewers want caches. The data is the same, but each consumer needs its own physical shape.

Decision 7 (schema governance) is still waiting on your confirmation of the five points.

Give me a flow diagram of whatever is discussed so far with data and query flow.

The full flow is in two diagrams: how data gets written, then how developers query it.

1. Write path: events travel from the app to the warehouse.

Interactive visual hidden when shared

Interactive visual hidden when shared

Every query goes through the adhoc workgroup, so its scan cap and alarms apply no matter which view a developer uses. The cheap path is the default: events_recent covers the last 7 days of silver. Reading full history has to be a deliberate, date-bounded choice. Click any box to go deeper on it.

Two things aren’t shown because they’re still open: Decision 7 (schema registry, validation, PII), which is waiting on your confirmation, and Decision 8 (operations and monitoring).

Now coming back to decision 7
What if property type changes what will happen in that case?
What happens to the old deprecated columns over time?

1. What happens if a property’s type changes
The answer depends on where the property lives.

Case A: the property is inside the properties JSON (most properties)
Layer	What happens
Collector	Validates against the registry, sees a type mismatch, accepts the event and tags it _invalid. Nothing is lost.
Storage	Nothing breaks. The JSON holds "42" one day and 42 the next.
Queries	This is where the problem shows up, in two ways (below).
Problem 1: queries fail loudly. json_extract_scalar always returns a string, so you cast it. A single row containing "abc" makes CAST(... AS integer) fail the entire query.
→ Use TRY_CAST, which turns bad values into NULL instead of failing.

Problem 2: results are silently wrong. This is the dangerous one. Suppose old app versions send duration = "1.5s" and new ones send duration = 1500 (milliseconds). Both look valid, and an average across them is meaningless. Nothing errors.
→ This is why the rule is never change a type or meaning under the same name. Old app versions keep sending the old format for months, so both formats coexist for a long time.

Case B: the property was promoted to a real, typed column
Iceberg allows only safe widening in place: int → long, float → double, and a wider decimal precision. Changes like string → int aren’t allowed.
The operational risk: if the hourly MERGE tries to write "abc" into an integer column, the whole batch fails and the pipeline stalls.
→ Silver must use TRY_CAST for promoted columns. Values that fail stay in the properties JSON, and the row is tagged _invalid. Never let one bad event stop the pipeline.
The fix in both cases
Add a new property name (duration_ms). Then hide the history behind a compatibility view:

sql
COALESCE(duration_ms, TRY_CAST(json_extract_scalar(properties,'$.duration') AS double) * 1000) AS duration_ms
Developers query one clean column, and the view takes care of the old format.

How Amplitude does it: Amplitude tolerates mixed types when ingesting events. Its tracking plans (Amplitude Data) flag type violations against the plan. Same idea: accept the data, flag the violation, and let consumers handle it.

2. What happens to deprecated properties and columns over time
A deprecated property in the JSON: new events simply stop including it, and old rows keep it forever. There’s nothing to clean up. The registry marks it as deprecated, with the date and its replacement.

A deprecated promoted column:

Stage	Action	Why
1. Deprecate	Mark it in the registry, add the replacement, and write both	Old app versions are still sending the old property
2. Wait	Until old app versions drop below a small share of traffic (track this by app_version)	Old mobile versions stay in use for a long time
3. Stop writing	New rows get NULL	Nulls cost almost nothing in Parquet, which stores them very compactly
4. Hide	Remove it from events_recent and the other views	Developers see a clean schema, while the table keeps its history
5. Drop (optional, after about 12 months)	ALTER TABLE DROP COLUMN	Only if keeping it causes confusion
What dropping a column actually does in Iceberg:

It’s a metadata change. The bytes stay in old data files until compaction rewrites those files without the column.
After the drop, the column’s data can’t be queried.
Re-adding a column with the same name does not bring the old data back. Iceberg tracks columns by internal ID, not by name, so the re-added column is a different column.
Renaming is safe, for the same reason. (In older Hive tables, renaming could silently scramble data.)
Safety net: raw keeps the original properties JSON, so even a dropped column’s history can be rebuilt.
Recommendation: in practice, almost never drop columns. Hide them in views. Keeping a mostly-null column costs nearly nothing, while dropping one can’t be undone.

Principle: stored history is immutable, and meaning changes are handled in views on top of it. Change how the data is presented, never the data itself. This is the same idea as API versioning, where you keep the old contract and add a new one alongside it.

Decision 7 is still open. Do you want to lock the five points, with these additions?

Use TRY_CAST everywhere, and never let one bad event fail the pipeline.
Use compatibility views for renamed or retyped properties.
Deprecate and hide columns rather than dropping them.
If the event becomes _invalid then the event got rename and it’s not queryable?
Everything but stays in json if I want to change anything in the future?
If I want to keep the new property type and drop the old property type will that also be handled?

1. Does _invalid rename the event or make it unqueryable? No.
_invalid is just a flag column added to the row. The event keeps its event_type, stays in the same table, and is fully queryable.

Column	Example
event_type	checkout_error (unchanged)
_invalid	true
_validation_errors	["duration: expected number, got string"]
Queries and views include flagged rows by default. Filter with WHERE NOT _invalid only when you want clean rows.
The flag also tells you exactly which rows need fixing later: WHERE contains(_validation_errors, ...).
_unregistered works the same way, for events that aren’t in the registry yet.
Principle: handle bad data by tagging it, not by moving it somewhere else. Data that’s been moved away is easy to forget; a tag sits right next to the data it describes.

2. Does everything stay in the JSON for future changes? Yes, with one rule to add.
Raw: completely lossless. Core columns, properties, and _extra hold the original payload.
But: raw moves to Glacier Deep Archive after 30 days. Restoring it is slow (hours) and costs extra.
So add this rule: silver keeps the full properties JSON even after a property is promoted. A promoted column is an extracted copy, never a replacement.
That makes silver your practical source for reprocessing, any time and without restoring anything.
The cost is negligible: the duplicated values compress well.
3. Keeping the new type and retiring the old one: yes, in two parts
Example: old app versions send duration = "1.5s", new versions send duration_ms = 1500. You want one clean column.

Part 1: convert going forward (in the silver transform).
Add the conversion rule to the hourly MERGE: "1.5s" becomes 1500. Old app versions keep sending the old format for months, so this has to run on every new batch, not just once.

Part 2: convert the past (a one-time backfill).

Run an UPDATE on silver that fills duration_ms from the old values in the JSON. Iceberg supports row-level updates.
Cost: this scans the affected partitions. At Year 1 that’s about 150 GB, roughly $0.75.
Then hide the old property from views. Its raw value still stays in the JSON permanently.
Caveat: this only works when the conversion is clear-cut. A value like "1.5s" converts cleanly to 1500 ms. An ambiguous value like "fast" becomes NULL and gets an _invalid flag. Never guess.

Approach	Upfront cost	Ongoing	When to use
Compatibility view only	None	Converts on every query	While both formats are still arriving
Silver transform + backfill	One-time scan	None. One clean typed column.	Once you’ve decided the new type is final
How Amplitude does it: Amplitude Data lets you update a property’s definition in the tracking plan, but historical data stays as it was sent. You’re doing better here: the data is actually converted, and the original is kept in the JSON.

Decision 7, final version to lock:
A schema registry in the repo that generates the types and drives collector validation.
Accept and flag problem events (_invalid, _unregistered, _validation_errors); never drop them.
Additive-only change rules. Use TRY_CAST everywhere, so one bad event never fails the pipeline.
Silver keeps the full properties JSON, and promoted columns are copies.
Type changes go into the silver transform, plus a one-time backfill. Compatibility views cover the transition period.
Hide deprecated columns rather than dropping them.
Volume alerts now, per-device throttling later.
PII-free events and deletes in silver, with the approach for raw confirmed by legal.
Confirm, and we’ll move on to Decision 8 (operations and monitoring).

If nobody approved a certain event_type still it will keep getting storage what happens after 7 days or 30 days?

Under the current design, nothing special happens. Unregistered events go through raw → silver like any other event, tagged _unregistered, and are kept forever. The 7-day and 30-day rules don’t apply to them:

Rule	What it actually does	Effect on unregistered events
7-day snapshot expiry	Deletes old table versions (used for time travel)	None. The rows stay.
events_recent 7 days	A view window	None. It only filters queries.
Raw → Glacier Deep Archive after 30 days	Changes the storage class of raw files	They move to cold storage like everything else, and stay there forever
Should they be kept forever? That’s a governance choice
How often will this happen? Rarely. Typed event sets mean code won’t compile if it uses an unregistered event. They can only come from paths that bypass the types: direct SDK calls, web or server code without types, or old builds.

Option	How it works	Trade-off
A. Keep forever (current)	Nothing to build	Junk events pile up. Storage is cheap, but it clutters queries and weakens governance.
B. 30-day grace period in silver	A daily job deletes unregistered rows older than 30 days, unless the event has been registered since	Pressures teams to register. Raw keeps a lossless copy, so nothing is truly lost.
C. Separate quarantine table	Unregistered events go to their own table, which has a time limit, and move to silver once registered	Cleanest separation, but more moving parts
D. Reject at the collector	—	❌ Old mobile builds can’t be fixed, so data would be lost permanently
Recommendation: B. Combine it with a daily report of the top unregistered event types by volume, sent to the owning teams. That gives owners 30 days to register, and stops data nobody claims from piling up.

How Amplitude does it: Amplitude Data lets you either allow unplanned events or block them. Your grace period sits in between: you accept the data, set a deadline, and keep a raw copy as a safety net.

A subtle issue: stored flags go out of date
_unregistered = true is stamped at the moment the event arrives. If a team registers that event on day 10, rows from days 1–9 still say _unregistered. The cleanup job would then wrongly delete events that are now approved.

Fix: store the registry itself as a small Glue table (synced from the repo whenever it changes). Then:

Views work out registration status at query time by joining against the registry table.
The cleanup job deletes only rows whose event_type is still missing from the registry.
Principle: a status that can change shouldn’t be frozen into immutable data. Store the facts (“this event arrived at time X”), and work out status from the current source of truth when you need it.

Your call: keep unregistered events forever (A), or a 30-day grace period with a registry table (B)?

I want to keep the unregistered events but if approved within 7 days or something should be marked as registered somehow. We can send slack notifications of each day new unregistered events or any miss match or property errors

Good choice: keep everything, track approval separately, and surface problems daily.

How “marked as registered” works
Don’t update rows. Work out registration status at query time from the registry table. That handles approval at any point, not just within 7 days:

Silver row: event_type = 'cart_retry'   (stored fact; never changes)
                    │
                    ▼  join at query time (in views)
Registry table: cart_retry → owner, schema, registered_at = Oct 25
                    │
                    ▼
View shows: registration_status = 'registered'   (for rows from before Oct 25 too)
Once someone registers the event and the registry syncs, all past rows show as registered immediately. No rewrite, no scan cost.
Keep first_seen_at (when the event first arrived) and registered_at (from the registry). That lets you report time to register per team, a useful governance metric.
Validation errors are different. They’re a historical fact measured against the schema version that existed when the event arrived. Store _validation_errors together with _schema_version, and don’t recompute them. If a schema later changes to accept a format, the old errors still correctly describe the data as it arrived.

Status	Changes over time?	Where it lives
Registered / unregistered	Yes	Worked out from the registry table, at query time
Validation errors	No (a fact at arrival time)	Stored in the row, with the schema version
Daily Slack digest
How it runs: a daily branch of the existing Step Functions workflow → Athena queries over the last 24 hours of silver → a Lambda formats the results → posts to Slack via an incoming webhook (with the URL kept in Secrets Manager).

What it reports:

New unregistered event types: first seen today, with count, platforms and app versions.
Validation errors: grouped by event type and error, with count and sample values.
Volume anomalies: events more than 5x above the same day last week (the loop-bug detector).
Keeping it from getting noisy:

Report only new or changed items. Track what’s already been reported in a small DynamoDB table, so the same unregistered event doesn’t show up in every digest.
Set thresholds: report validation errors only above about 0.1% of that event’s volume, or above a minimum count.
Route alerts to the owner’s channel using the registry. Unregistered events have no owner yet, so they go to a default channel per platform team.
Cost: a few Athena queries over one day of silver, which is pennies per day.

AWS alternative: AWS Chatbot (now called Amazon Q Developer in chat applications) can forward CloudWatch alarms to Slack. Use it for the real-time pipeline alarms in Decision 8, and the Lambda for this formatted daily digest.

How Amplitude does it: Amplitude Data surfaces unplanned events and schema violations for review and can notify the team. You’re getting the same loop with ownership-based routing built in.

Principle: governance only works when the feedback reaches the right person, quickly, without noise. A digest nobody reads is the same as having no governance.

Decision 7, final version to lock
A schema registry in the repo that generates the types, drives collector validation, and syncs to a Glue registry table.
Accept and flag problem events. Unregistered events are kept forever, and their registration status is worked out from the registry (so it applies retroactively).
Validation errors are stored together with _schema_version.
Additive-only changes, with TRY_CAST everywhere.
Silver keeps the full properties JSON; promoted columns are copies.
Type changes are handled in the silver transform plus a one-time backfill, with compatibility views during the transition.
Hide deprecated columns rather than dropping them.
A daily Slack digest (new unregistered events, validation errors, volume anomalies), deduplicated and routed to owners.
Per-device throttling later.
PII-free events and deletes in silver, with the approach for raw confirmed by legal.
Confirm, and we’ll move to Decision 8 (operations and monitoring).

We are a small team so ownership is just the tech team

That simplifies things. Here’s what changes:

Routing: gone. Everything goes to one Slack channel, for example #analytics-events.
The registry’s owner field is replaced by added_by and purpose. On a small team, the useful question six months later isn’t “which team owns this?” but “who added this, and why?”
Keeping noise down matters even more, because the whole team sees every message:
Post only when there’s something new: a new unregistered event, a new validation error, or a volume anomaly. Quiet days get no message.
Consider a weekly roll-up (top events by volume, unregistered events still open, error trends) as the one regular message.
Principle: scale the process to the team. Ownership routing and approval workflows are for organizations with many teams. A small team needs one channel, clear context on each event, and no noise.

Decision 7: Locked
A schema registry in the repo (added_by, purpose, properties and their types, PII flag). It generates the types, drives collector validation, and syncs to a Glue registry table.
Accept and flag problem events. Unregistered events are kept forever, and their registration status is worked out from the registry, so it applies retroactively.
Validation errors are stored together with _schema_version.
Additive-only changes, with TRY_CAST everywhere.
Silver keeps the full properties JSON; promoted columns are copies.
Type changes are handled in the silver transform plus a one-time backfill, with compatibility views during the transition.
Hide deprecated columns rather than dropping them.
One Slack channel: a daily message only when something is new, plus a weekly roll-up.
Per-device throttling later.
PII-free events and deletes in silver, with the approach for raw confirmed by legal.
Next is Decision 8: Operations: how you’ll know the pipeline is healthy, how you’ll detect lost data, and how you’ll track cost. Ready when you are.

Pii flag is it per property or event_type level
I want to implement device level throttling

1. PII flag: per property
Per property is the right level. A single sensitive property shouldn’t mark the whole event as sensitive, and every action you’d take (dropping, hashing, deleting) happens per property anyway.

yaml
event: checkout_error
properties:
  error_code: { type: string, pii: none }
  email:      { type: string, pii: sensitive, action: drop }
  user_ref:   { type: string, pii: pseudonymous, action: hash }
Use levels, not just true/false: none, pseudonymous, and sensitive.
The collector enforces each property’s action: drop removes the value before it’s ever stored, and hash replaces it with an HMAC.
Plain hashing is not anonymization. A SHA-256 of an email can be reversed by hashing a list of known emails and comparing. HMAC uses a secret key, which prevents that.
Keep a derived event-level contains_pii flag purely for convenience: true if any property is flagged.
Principle: enforce privacy at the earliest point, the collector. Anything that reaches raw is immutable and sits in Deep Archive. Removing it there is expensive.

2. Throttling per device
How Amplitude does it
Amplitude’s API returns 429 when a single device sends too much too fast. The SDK backs off and retries.

The subtlety: a legitimate burst looks exactly like a bug
A phone that was offline for a day flushes 1,000 queued events at once. A loop bug also sends 1,000 events. Throttle on arrival rate alone and you punish legitimate offline devices.

The difference is in the event timestamps:

Offline flush	Loop bug
Arrival	Burst	Burst
event_time spread	Spread over hours	Packed into seconds
Event types	Mixed	The same event_type, repeated
So use two limits:

Per device, overall: a token bucket that allows large bursts (for example, 2,000 events of burst capacity, refilling at 20/second). That allows offline flushes and stops floods.
Per device + event type, by event_time: for example, more than 50 of the same event within one minute of event time. This is the loop detector.
What to do when a limit is hit
Response	Effect	Use for
429	The SDK retries later, and its local queue grows	Floods of requests (limit 1)
200, drop the excess, record a summary	No retry storm. Store one row like “device X, event Y: 4,870 dropped.”	Loop bugs (limit 2), because those events are junk anyway
The summary rows flow into the daily Slack digest, so the team sees “loop detected in cart_retry on app version 5.2.1.”

Where the counters live
Option	Accuracy	Infrastructure	Cost
In memory, per Fargate task	About N times too generous with N tasks (with 2–4 tasks, up to 4x off)	None; the collector stays stateless	$0
ElastiCache (Valkey/Redis), with an atomic Lua script	Exact, across all tasks	A stateful dependency	About $25–50/month for a small node with a replica
What’s needed here is loop protection. A loop multiplies volume by 100x or more, so being up to 4x imprecise still catches it. Recommendation: start in memory, with a bounded map of recent devices per task. Move to Redis only if you need exact limits (for example, protecting against abuse). The Redis version is a contained change inside the collector.

Non-negotiable rules
Fail open. If the limiter errors, or Redis is slow or down, accept the event. Throttling must never become a source of data loss.
If you use Redis: time out within 5–10 ms, and accept the event if the timeout hits.
device_id comes from the client and can be faked. This throttle protects against bugs, not attackers. For abuse protection, add AWS WAF rate-based rules per IP address on the load balancer as a separate layer.
Principle: match the precision of a control to the threat it addresses. Approximate limits are fine against 100x failures, and exact limits only matter for adversarial cases.

To lock:
PII flag per property, with levels and a collector action (drop, or hash using HMAC)?
Throttling: a per-device token bucket (returns 429) plus a per-event-type loop guard (returns 200, drops the excess, records a summary)?
In-memory counters first, Redis later? Fail open, plus WAF limits per IP?
Will do high level stuff later but for now let’s get it done with Redis because of multi region support I wanted to talk to you later but in memory is highly risky

Redis it is. This also sets you up properly for multi-region later.

Throttling: locked
ElastiCache running Valkey (an open-source Redis fork, cheaper than Redis OSS on ElastiCache), with a primary and replica across availability zones.
Atomic Lua scripts for both limits: the per-device token bucket (returns 429) and the per-device + event-type loop guard (returns 200, drops the excess, records a summary).
Keys expire on their own (a few minutes after last use), so memory stays bounded.
Rough sizing: about 1M active devices × 2 keys × ~100 bytes ≈ 200 MB, which a small node handles easily.
Fail open: a 5–10 ms timeout, plus a circuit breaker. If Redis has been erroring, skip the check entirely for a short cooldown instead of paying the timeout on every request.
AWS WAF per-IP rate limits in front of the load balancer, for abuse.
PII: locked as per-property levels, with the collector enforcing drop or hash (HMAC).

Parked for the multi-region discussion
One thing to keep in mind: ElastiCache Global Datastore replicates in one direction only, and asynchronously. Secondary regions are read-only, so they can’t increment counters. That means counters will most likely be per region. That’s usually fine, because latency-based routing sends each device to one region consistently. We’ll go into the details, along with Firehose, S3 and the catalog across regions, when you’re ready.

Decisions 1–7 are now locked. Next is Decision 8: Operations (pipeline health, detecting data loss, cost tracking, alarms). Shall I continue?

How much aws waf will gonna cost


Searched the web
Searched the web
About $10–12/month at Year 1, and about $30–35/month at 10x. It’s cheap.

Pricing
Component	Price
Web ACL (the rule set attached to the load balancer)	$5.00/month
Each rule (rate-based rules cost the same as regular rules)	$1.00/month
Requests inspected	$0.60 per million
Logs	500 MB of CloudWatch logs included per 1M requests
Your estimate
WAF counts HTTP requests, not events. The SDK sends about 20 events per request, so request volume is far below event volume.

Year 1 (~1B events/yr)	10x (~10B events/yr)
Requests per month	~4M	~42M
Web ACL	$5	$5
Rules (rate-based per IP + 2 AWS managed rule groups)	$3	$3
Requests	~$2.50	~$25
Total	~$10–11/month	~$33/month
One important caveat for mobile: carrier NAT
Mobile carriers put thousands of phones behind a single public IP address (called CGNAT). A tight per-IP limit would block real users on the same carrier.

Set the per-IP limit generously so it only catches clearly abusive traffic. Rate-based rules count requests per IP over a trailing 5-minute window.
Run it in Count mode first for a week or two, look at actual peak rates per IP, and then switch it to Block.
Leave fine-grained limiting to your Redis per-device limits.
Principle: each layer limits on the identity it can trust. WAF trusts IP addresses (coarse, but the client can’t fake them). Redis trusts device_id (fine-grained, but it can be faked). Together they cover both abuse and bugs.

Ready for Decision 8?

Sources:

AWS WAF Pricing
AWS WAF FAQs
Yes lock the decisions I agree and then move next

WAF is locked: one web ACL with a generous per-IP rate rule (Count mode first, then Block) plus 2 AWS managed rule groups, at about $10–11/month.

Decision 8: Operations
How Amplitude does it
Amplitude has dedicated SRE and data-reliability teams, ingestion targets (SLOs), and data-quality monitoring. You’re a small team, so the goal is a few high-signal alerts, and as much automatic recovery as possible.

The key insight: how urgent a failure is depends on whether you can recover from it
Stage	If it breaks	Data at risk?	Urgency
Collector / Firehose	Events can’t get in	Partly. The SDKs keep queuing and retrying on the device, which buys you hours, but device queues have a size limit, so a long outage eventually drops events.	High
Hourly pipeline	Silver goes stale	No. Raw is durable, and the MERGE can safely be rerun.	Business hours
S3 Tables maintenance	Queries slow down	No	Low
Slack digest	You miss a report	No	Low
Everything after raw can be recovered. So only the ingestion edge needs urgent alerts. That one property is what makes this system practical for a small team to run.

8a. What to monitor at each stage
Stage	Metrics	Alert when
Collector	Load balancer 5xx rate, p99 latency, request count, Firehose write failures, Redis circuit breaker open	5xx above 1%, Firehose failures, traffic drops more than 50% vs the same time last week
Firehose	Data freshness, delivery success, records sent to errors/, throttling	Freshness above 15 minutes, any conversion errors, any throttling
Pipeline	Step Functions failures, checkpoint lag (now minus the last processed hour), MERGE duration	A run fails twice in a row, lag above 3 hours
Silver	Files per partition, average file size (a custom check, since S3 Tables has no maintenance dashboard)	Average file size below ~32 MB, a sign compaction isn’t keeping up
Cost	Athena data scanned per workgroup, AWS Budgets, Cost Anomaly Detection	Budget threshold crossed, or an anomaly
Why watch for traffic drops: the worst failures are silent. A new app release with a broken SDK setup produces zero errors, just fewer events. Only a volume comparison catches that.

8b. Detecting data loss: reconcile counts every hour
Count events at every stage, for each arrival hour:

Collector accepted (custom metric)  ≈  Raw rows  ≥  Silver rows (raw minus duplicates)
Raw lower than accepted by more than 0.1% → events were lost between the collector and S3.
Duplicate rate (raw minus silver) normally stays below 1%. A spike means the SDK is retrying heavily, which usually points to collector timeouts.
The hourly pipeline runs this check as a final step and alerts on any mismatch.
Synthetic canary events: a scheduled Lambda sends a test event with a known ID through the public endpoint every 5 minutes. Then check that it appears in raw within 15 minutes and in silver within 2 hours. This is an end-to-end, black-box test of the whole path, including DNS, WAF and the load balancer. Canary rows get event_type = '_canary', which views filter out.

Principle: internal metrics tell you each component thinks it’s healthy. Reconciliation and canaries tell you the system actually works. You need both.

8c. Targets (SLOs)
SLO	Target
Raw freshness	15 minutes or less, for 99% of events
Silver freshness	2 hours or less
Reconciliation gap	0.1% or less per hour
Collector availability	99.9% (the SDK’s queue absorbs short outages)
8d. Where alerts go
#analytics-alerts in Slack (separate from the events digest channel), via CloudWatch alarm → SNS → AWS Chatbot.
Paging (PagerDuty or Opsgenie, if you use one): only for the collector or Firehose being down for more than 30 minutes. Everything else waits for business hours.
8e. Runbooks (write them now, while the reasoning is fresh)
Replay from raw
Up to 30 days old: reset the checkpoint and rerun the pipeline.
Older: restore from Deep Archive first (hours to days, depending on the retrieval tier), then rerun.
Backfill after a property is promoted or its type changes.
Handle a user deletion request.
Respond to a loop-bug or volume anomaly.
Rotate the HMAC secret and the Slack webhook URL.
8f. Cost tracking, including the ROI story
Tag every resource with service=events-pipeline, and break cost down by stage: collector, Firehose, storage, Athena, Redis, WAF.
Track a project KPI: cost per million events here vs. Amplitude’s effective rate. That’s the number leadership cares about, and it’s what justifies the project.
8g. Infrastructure and environments
Everything in infrastructure-as-code (CDK or Terraform): collector, Firehose, tables, workgroups, alarms.
Separate dev and staging Firehose streams and tables, with a short raw retention period.
To lock Decision 8, confirm:
Urgent alerts only for the collector and Firehose; everything else during business hours?
Hourly count reconciliation plus synthetic canary events?
The SLO targets above?
Tracking cost per million events against Amplitude as the project KPI?
Infrastructure-as-code: CDK or Terraform, whichever your team already uses?
We don’t use paging

Without paging, the edge has to heal itself, and the few urgent alerts need a channel people actually notice.

What changes
1. Two Slack alert channels:

#analytics-alerts-critical: collector or Firehose down, a reconciliation gap, or the canary event missing. Alerts use @here, and the team turns on mobile push notifications for this channel only.
#analytics-alerts: everything else, handled during business hours.
Optionally, add SNS text or email alerts for critical alarms. It costs pennies and reaches people when Slack is muted.
2. Rely on automatic recovery, because nobody gets woken up:

ECS restarts unhealthy tasks on its own, and runs at least 2 tasks across availability zones.
Autoscaling on request count and CPU.
Firehose is fully managed, and Redis fails open, so neither can block ingestion.
Pipeline retries are safe, because the MERGE is idempotent.
3. Treat the SDK’s queue size as your outage budget. This is the most important point here.

Without paging, an outage at 11pm might not be noticed until 9am, about 10 hours.
The device-side queue is the only thing protecting events during that window. Check the Amplitude SDK’s offline storage limit (the maximum number of queued events) and raise it in the config of the trackInternal() instance.
Example: a device creating about 200 events an hour needs a queue of more than 2,000 to survive 10 hours.
Principle: if you don’t have on-call, buffering is your on-call. Size the buffers for your realistic response time, not your best case.

Decision 8: Locked
No paging. A critical Slack channel with @here and mobile push (plus optional SNS text), and a regular alerts channel for business hours.
Automatic recovery at the edge (ECS restarts, autoscaling, Redis failing open, safe pipeline retries).
The SDK’s offline queue is sized for an outage of about 12 hours.
Hourly count reconciliation, plus a synthetic canary event every 5 minutes.
SLOs: raw within 15 minutes, silver within 2 hours, reconciliation gap of 0.1% or less, collector availability 99.9%.
Track cost per million events against Amplitude as the project KPI.
Runbooks for replay, backfill, user deletion, anomalies, and secret rotation.
Infrastructure-as-code for everything, with separate dev and staging. Still open: CDK or Terraform.
All 8 decisions are now locked. Two natural next steps:

The multi-region design we parked earlier (Redis counters, Firehose, S3, and the catalog across regions).
A full design document covering every decision, its rationale, and the Amplitude comparison. I can create it as a doc you can share with the team.
Which would you like?

No paging
Single slack channel with here tag and urgent tag
Cdk for infra 
Rest everything is fine

All locked.

Final alerting setup: one Slack channel, with two severity levels in it.

[URGENT] + @here: the collector or Firehose is down, there’s a reconciliation gap, or the canary event is missing.
[INFO], no mention: everything else, handled during business hours.
One risk with a single channel: if [INFO] messages get noisy, people mute the channel, and then [URGENT] alerts get missed too. Keep [INFO] rare and specific to things that need action. The daily digest and the weekly roll-up already cover what’s merely good to know.

Infrastructure: CDK. That’s a natural fit, since you can write it in TypeScript, the same language as the collector and the generated event types. You could even generate the Glue registry table definitions from the same schema registry.

All 8 decisions are locked. What’s next:

The multi-region design (Redis counters, Firehose, S3 and the catalog across regions), or
A full design document covering every decision, its rationale, and the Amplitude comparison, which you can share with the team.
Multi region should be handled at collector level atleast

Multi-region at the collector level is the right place to start. Before the design, one challenge, because it decides whether this is worth the cost.

First: what’s the reason for multi-region?
Reason	Do you really need it?
Availability (survive a region outage)	Maybe not. The SDK’s offline queue already absorbs about 12 hours of collector outage. A full AWS region outage is rarer and usually shorter than that. A single region plus the SDK buffer may already meet your 99.9% target.
Latency (users far from your region)	Mostly not. SDK uploads happen in the background, so users don’t feel latency. It only matters for flaky long-distance connections.
Data residency (EU data must stay in the EU, for example)	Yes, and this changes the design. Data then must not be copied to one central region.
How Amplitude does it: Amplitude runs separate US and EU data centers, with a separate EU endpoint. That multi-region setup exists for data residency, as separate silos, not as one global pipeline with failover.

An extra region costs roughly $150–200/month: Fargate, load balancer, Redis, WAF, plus cross-region transfer.

The design (assuming availability and latency, not residency)
          events.company.com (Route 53: latency-based routing + health checks)
              │                                   │
     ┌────────▼────────┐                 ┌────────▼────────┐
     │ Region A (home) │                 │ Region B        │
     │ WAF → LB →      │                 │ WAF → LB →      │
     │ collector+Redis │                 │ collector+Redis │
     │ → Firehose      │                 │ → Firehose      │
     │ → Raw A         │◄── S3 cross-────│ → Raw B         │
     │                 │  region replica │                 │
     │ Pipeline →      │                 │                 │
     │ Silver (single) │                 │                 │
     └─────────────────┘                 └─────────────────┘
Key decisions
1. Each region works independently up to raw. The collector writes to its own region’s Firehose.

Why not write across regions to the home Firehose? The collector waits for Firehose before responding, so every request would carry cross-region latency. Worse, a home-region outage would break every region, which defeats the purpose.
2. Raw is copied to the home region with S3 Cross-Region Replication, into a region= partition. Most objects replicate within minutes. There’s a paid option with a 15-minute guarantee if you need one.

3. Silver exists only in the home region. One pipeline, one Iceberg table, one writer. Multi-writer Iceberg across regions is complexity you don’t need.

4. Routing: Route 53 latency-based routing with health checks, and a short DNS TTL (60 seconds).

Caveat: some mobile networks and operating systems cache DNS longer than the TTL, so failover can be slow.
Upgrade path: AWS Global Accelerator gives you fixed anycast IPs and failover in seconds, with no DNS caching problem. It costs roughly $18/month plus a per-GB charge.
Issues that only appear with multiple regions
Issue	Handling
A device retries through a different region during failover	Duplicates land in two regions’ raw data. The silver MERGE on insert_id removes them. Already handled.
Redis counters are per region	On failover, a device’s counters start from zero, so limits are briefly lenient. That’s acceptable, and consistent with failing open.
The HMAC secret for PII hashing	It must be the same in every region. Otherwise the same value hashes differently in each region, and joins silently break. Use Secrets Manager multi-region replication.
Schema registry	Shipped with each collector deploy, so the same version runs in every region.
Monitoring	A canary event and count reconciliation per region, plus a check on replication lag.
CDK	One stack parameterized by region. The home region adds the pipeline and silver stacks.
If residency applies: skip the replication for regulated regions, and give each one its own pipeline and silver, as separate silos, like Amplitude. Canadian law also needs attention here: Quebec’s Law 25 requires a privacy assessment before transferring personal data outside Quebec. Check with legal.

Principle: multi-region is a cost you pay for a specific reason. Each region should work on its own along the urgent path (ingestion), and centralize only the part that can be recovered and isn’t urgent (processing).

Which is the main reason for you: availability, latency, or data residency? The answer decides whether we lock this design, go with separate regional silos, or stay in one region for now.

I was considering latency because we have users from all over the world and we primarily use only us west 2

For a latency reason, I’d not start with full multi-region collectors. There’s a cheaper way to get most of the benefit.

Why latency matters less than it seems here
SDK uploads happen in the background, so users never wait for them. For far-away users, latency shows up indirectly:

More failed uploads on poor networks (long round trips plus packet loss lead to timeouts and retries).
More duplicates, from those retries.
Slower handshakes: from Asia to us-west-2, every TCP and TLS round trip is around 150–250 ms.
The real problem to solve is connection reliability far from your region, not response time.

Options
Option	How it helps	Cost	Complexity
CloudFront in front of your existing load balancer	Connections (TCP and TLS) are set up at a nearby edge location, and the data travels to us-west-2 over AWS’s private network	Roughly $5–45/month as volume grows (per-request plus transfer-to-origin charges)	Low: one distribution
Global Accelerator	Fixed IPs routed to the nearest AWS edge, then over the AWS network	~$18/month plus a per-GB premium	Low, but the TLS handshake still goes all the way to the load balancer
Full collectors in multiple regions	Everything happens nearby	~$150–200/month per region	High: replication, per-region Redis, a shared HMAC secret, per-region monitoring
Recommendation: CloudFront in front of the single-region collector
About 80% of the latency benefit for a fraction of the cost and operational effort.
Bonus: one Redis means throttling stays exact globally, with no per-region counter caveats.
Move WAF onto CloudFront. Abuse gets blocked at the edge, before it ever crosses an ocean.
Everything after the collector stays the same: one Firehose, one raw bucket, no replication.
Security detail: lock the load balancer down so it accepts traffic only from CloudFront. Use AWS’s managed list of CloudFront IP ranges in the security group, plus a secret header that CloudFront adds and the collector checks.

Measure before going further
Use CloudFront’s CloudFront-Viewer-Country header to tag each event with country. Country is coarse and not PII. Then watch, per country:

Upload delay: server_received_at − event_time.
Duplicate rate: a high rate means timeouts and retries.
If one area stands out even with CloudFront, for example Southeast Asia with a 5% duplicate rate, that’s the evidence for adding a regional collector there. You’d point CloudFront’s origin at a Route 53 latency-based record, and the rest of the multi-region design from earlier applies unchanged.

How Amplitude does it: Amplitude serves global users from a single main region (US), with a separate EU region only for data residency. A single region with a good edge layer is the industry-standard answer for collecting data globally.

Principle: fix the symptom at the cheapest layer first (here, connection setup at the edge), measure what’s left, and only spread state across regions when the data proves you need to.

To lock:
CloudFront in front of the single-region (us-west-2) collector, with WAF moved to CloudFront?
The load balancer locked to CloudFront only?
A country field on each event, with delay and duplicate-rate tracking per country to decide on any future regional collectors?
Let’s start with cloudfront But I didn’t understood this fully

Here’s the full picture. The key thing to understand is that for your use case CloudFront is not a cache. It acts as a nearby front door to your servers.

The problem: round trips over long distances
Take a user in Mumbai sending events to your collector in Oregon (us-west-2). One round trip (a message there and back) takes about 250 ms.

Before any data moves, a new HTTPS connection needs several round trips:

Step	Round trips	Time from Mumbai
TCP handshake (“can we talk?”)	1	250 ms
TLS handshake (“let’s encrypt”)	1 (TLS 1.3) or 2 (TLS 1.2)	250–500 ms
Send events, get a 200 back	1	250 ms
Total	3–4	~750 ms–1 s
All of that crosses the public internet, across many networks and an ocean. When a packet gets lost, the retransmission also takes about a full round trip. On a weak mobile signal, that’s when timeouts happen. That’s where the failed uploads and duplicates come from.

What CloudFront changes
CloudFront has hundreds of edge locations worldwide, including one in Mumbai.

WITHOUT:  Phone ──── public internet, 250 ms per round trip × 3–4 ────► Oregon collector

WITH:     Phone ──► Mumbai edge ════ AWS private network ═══► Oregon collector
                  ~10 ms per          connection already open,
                  round trip          so only 1 trip is needed
The handshakes happen at the edge. TCP and TLS take two quick round trips to Mumbai, about 20 ms in total instead of 500–750 ms.
The edge already has an open connection to your collector. CloudFront keeps warm, reused connections to your load balancer, so there’s no new handshake across the ocean. The events make one trip, about 220 ms.
That trip runs over AWS’s private network, not the public internet. It’s more direct, with less packet loss and steadier timing.
Packet loss on the weak part (the phone’s own connection) is cheap to recover from, because a retransmission only goes as far as the nearby edge.
Result: about 250 ms instead of about 1 s, and far fewer timeouts on bad networks. That means fewer retries, fewer duplicates, and less battery and data used on the phone.

Why there’s no caching: caching only applies to repeated GET requests for the same content. Your requests are POSTs with unique event batches, so CloudFront simply forwards them. This kind of setup is usually called CloudFront as an edge proxy or API acceleration.

The other two points
Locking the load balancer to CloudFront only:
Your load balancer still has a public address. If someone finds it, they could send traffic directly and bypass WAF at the edge. To close that gap:

The security group only allows AWS’s published list of CloudFront IP ranges.
CloudFront adds a secret header to every request, and the collector rejects any request without it. That stops other people’s CloudFront distributions from reaching you too.
A country field for future decisions:
CloudFront tells the collector which country each request came from, through a header. Store it on each event. Then you can ask, per country:

How long do events take to arrive? (server_received_at − event_time)
How often do duplicates happen? (A high rate means timeouts and retries.)
If one region still looks bad even with CloudFront, that’s the evidence for adding a regional collector there. Until then, one region is enough.

Principle: latency is mostly made of round trips × distance. You can’t shorten the distance, but you can reduce the number of long round trips, by setting up connections near the user and reusing them across the long-distance link. HTTP keep-alive, connection pooling and CDNs all apply the same idea.

Locked:
CloudFront in front of the single-region us-west-2 collector, as an edge proxy with no caching, and WAF moved to CloudFront.
The load balancer accepts traffic only from CloudFront (managed IP list plus secret header).
A country field on each event, with delay and duplicate rate tracked per country.
That completes the multi-region decision for now. Should I put everything into the full design document next?

Yes great. Let’s design the doc

I’ll write the full design document covering every locked decision, with rationale, trade-offs and the Amplitude comparison.


Used Claude Docs integration, loaded a skill
Used Claude Docs integration, loaded a skill
Outline is up; now filling in context and goals.


Used Claude Docs integration
Used Claude Docs integration
O

Used artifacts
Now writing the requirements section.


Edit doc
Edit doc
Next: client SDK and routing.


Edit doc
Edit doc
Now the edge and collector.


Edit doc
Edit doc
Next: Firehose and the raw layer.


Edit doc
Edit doc
Now the silver layer.


Edit doc
Edit doc
Next: table format, catalog and storage.


Edit doc
Edit doc
Now the query layer.


Edit doc
Edit doc
Next: schema governance and privacy.


Edit doc
Edit doc
Now operations.


Edit doc
Edit doc
Now the cost estimate.


Edit doc
Edit doc
Next: future evolution and the verification checklist.


Edit doc
Edit doc
Now the decision log.


Edit doc
Edit doc
Prose sections are done. Now drawing the architecture overview.


Read a file, used Claude Docs integration
Read a file, used Claude Docs integration
The design doc is ready: every locked decision with its rationale, the Amplitude comparison, cost estimates, the architecture diagram, and a checklist of what to verify during implementation. You can edit it directly, comment on any section, or share it with the team.

how can we make the event registry easy so that anyone adding event can be able to easily approve the event or mark any property as PII information.

Make the repo the single source of truth, and add tools that bring the registry to wherever developers already are: their terminal, their pull requests, and Slack. Approving an event then just means merging a PR.

Three ways an event enters the registry
Path	When it happens	How it feels for the developer
1. CLI scaffold	A developer is adding a new event in code	Run one command and answer a few prompts. A PR is opened for them.
2. Auto-drafted PR	The event already showed up in production unregistered (web, old builds, bypassed types)	A PR appears with the definition already filled in from real data. Review and merge.
3. Slack buttons	The daily digest flags something	Click Approve, Mark PII or Ignore in Slack. A bot updates the PR.
All three end in the same place: a PR on the registry folder. Merging it is the approval, so there’s a single audit trail.

Path 1: CLI scaffold (the main path)
events add checkout_retry
  → purpose? "Track retry attempts after payment failure"
  → properties? attempt (number), error_code (string), card_last4 (string)
  → PII for card_last4? [suggested: sensitive → drop]
  → generates registry YAML, regenerates the types, opens a PR
Because event types are generated from the registry, trackInternal('checkout_retry') won’t compile until the event is registered. The compile error prints the exact events add command to run.
Put the same instruction in CLAUDE.md / AGENTS.md, so AI assistants run the CLI instead of writing YAML by hand.
Path 2: Auto-drafted PRs from observed data (the convenience path)
A daily job looks for unregistered event types in silver and:

Infers property types from real values, for example “attempt: always a number in 4,210 events.”
Guesses PII from names (email, phone, name, address, lat, lng, ip) and from values (email or phone patterns).
Opens a draft PR with the definition, sample values and counts, and links it in the Slack digest.
How Amplitude does it: Amplitude Data offers the same pattern, letting you add unplanned events to the tracking plan with properties inferred from real data. It turns registration from writing a definition into reviewing one.

Path 3: Slack buttons
The digest message for each new event has buttons:

Approve: merges the drafted PR (if CI passes).
Mark PII: choose a property and a level; the bot commits that change to the PR.
Ignore: labels the event as known noise, so it isn’t reported again.
This needs a small Slack app plus a Lambda with GitHub access. It’s optional; add it once paths 1 and 2 feel slow.

Making PII easy and safe
The key rule: privacy fails closed. This is the opposite of ingestion, which fails open.

Situation	Default
A property has no PII level set	CI fails. Every property needs an explicit level.
A property’s name or values look like PII	Pre-filled as sensitive → drop. A human has to downgrade it, with a short reason.
An unregistered event arrives with values that look like email addresses or phone numbers	The collector masks those values before storage, so nothing sensitive reaches raw before anyone has reviewed it
Why the asymmetry: losing an engineering event costs little. Storing PII in an immutable raw layer that sits in Deep Archive is expensive to fix and a legal risk. So data defaults to being kept, while sensitive values default to being dropped.

CI checks on registry PRs
The schema is valid, and every property has a type and a PII level.
Naming conventions: snake_case event names, with units in names (_ms, _count).
Breaking-change check against main: a changed type or a removed required property fails the build and points to the rules (use a new name, or create a _v2 event).
Types regenerate cleanly.
Approval on a small team: a CODEOWNERS entry on the registry folder (the tech team) and one reviewer. Merging deploys the new registry to the collector and syncs the Glue registry table.

Principle: governance gets followed when the right path is also the easiest one. Turn writing into reviewing, make safe defaults automatic, and let CI enforce the rules so people don’t have to remember them.

To lock:
Repo plus PR as the approval mechanism, with the CLI as the main path?
Auto-drafted PRs from observed data, with PII guessed from names and values?
Privacy fails closed: an explicit PII level is required, suspected PII defaults to drop, and the collector masks values in unregistered events?
Slack buttons now, or later?
Once locked, I can add this as a section in the design doc.

Can we not skip the PR process for this and make it easily accessible. I was thinking of having a webapp for all these kind of stuff and even for some traffic info graph or some other things which make the system overall visible with the help of webapp.

A web app is a good call, and it’s essentially what Amplitude itself does. Amplitude Data is a UI for the tracking plan, with approvals and an inbox of unplanned events, plus a CLI (ampli pull) that pulls the plan into code generation. You’d be building a lean, internal version of that, plus a system health view.

It changes one foundational choice, so here’s what moves.

What changes: the registry’s source of truth moves from the repo to a database
PR-based (previous)	Web app (new)
Source of truth	YAML files in the repo	A database behind the web app
Who can approve or mark PII	Developers with repo access	Anyone on the team, in a browser
Audit trail	Git history	A change log in the database (who, what, when)
Validation	CI checks	The same checks, run in the app’s API on every save
Collector gets updates	On deploy	Live: it reloads the registry within about a minute, no deploy
Compile-time types	Generated from YAML	Generated by a CLI that pulls from the registry API (events pull)
What you give up: PR discussion and git diffs. To get history back: export the registry to the repo every night as a read-only snapshot.

One rule that now matters more: since builds pull the registry, never delete or rename an event in the app. Only deprecate it. Otherwise old branches and builds break. That’s consistent with the change rules you already locked.

Architecture (all AWS, your stack)
Browser ─► ALB (OIDC sign-in via company SSO) ─► Next.js app on Fargate
                                                   │
                                                   ▼
                                          DynamoDB registry table
                                          (+ change log entries)
                                                   │  DynamoDB Streams
                                                   ▼
                                Lambda: write registry snapshot to S3
                                        → update the Glue registry table
                                        → post to Slack
                                        → collectors reload it (poll about every 60 s)
Sign-in: ALB’s built-in OIDC authentication, connected to your identity provider. You write no auth code.
Database: DynamoDB. The registry is small, costs pennies, and you know it well. Each event version is one item, plus change-log items. A relational database would be overkill here.
Keep it separate from ingestion: its own small load balancer and service. A bug in the internal tool must never affect the collector.
Cost: about $30–50/month (one small Fargate task, a load balancer, DynamoDB at near zero).
MVP pages
Page	What it does
Event catalog	Search events: purpose, added_by, properties, types, PII levels, status, first and last seen, a volume sparkline
Review queue	Unregistered events with properties inferred from real data and PII guesses. Buttons: Approve, Mark PII, Ignore. This replaces the PR flow and the Slack buttons; the Slack digest just links here.
Data quality	Validation errors by event and property, with sample values
System health	Events per minute by platform, country and app version; raw and silver freshness; reconciliation gap; canary status; throttled devices
Cost	Monthly cost per stage, Athena scan per workgroup, cost per million events vs Amplitude
PII stays fail-closed in the UI: every property needs an explicit level. Suspected PII starts as sensitive → drop. Downgrading it requires a reason, which is recorded in the change log.

The trap: where the charts get their data
Don’t run Athena queries on every page load. That’s the dashboard cost problem from Decision 6: about 8.6 TB a day for one busy dashboard.

Data	Source	Why
Live operations metrics (requests, errors, freshness, canary)	CloudWatch metrics	Low-cardinality, cheap, near real-time
Event volumes by type, platform, country, version	A stats table written by the hourly pipeline (gold layer, DynamoDB)	Breaking metrics down by event type in CloudWatch gets expensive fast (custom metrics are billed per metric)
Cost	Cost Explorer API, cached daily	Each API call is billed
This is the “build gold on repeated demand” rule in action: the web app is that repeated demand.

Principle: an internal platform tool is a product. Start with the smallest version that removes the most friction (catalog, review queue, health), and keep its blast radius separate from the critical path.

To lock:
Web app as the registry’s source of truth (DynamoDB plus change log), with no PR process?
An events pull CLI for type generation, and collectors reloading the registry live?
Next.js on Fargate with ALB OIDC sign-in, separate from ingestion?
MVP pages: catalog, review queue, data quality, health, cost?
Charts read from CloudWatch and a pipeline-written stats table, never live Athena?
Also, We are using amplitude RN sdk.

The React Native SDK makes several parts of the design simpler, and adds one constraint to check.

What gets simpler
1. One generated types file instead of three.
iOS and Android share one TypeScript codebase, so the typed InternalEvent set is a single .ts file. The events pull CLI generates it once. The same file also works for the small web app if that uses Amplitude’s Browser SDK (also TypeScript).

2. A second instance is supported.
The current RN SDK (@amplitude/analytics-react-native) supports creating more than one instance and a custom server URL. Instance B for trackInternal() uses the same package, so app size doesn’t grow. The older @amplitude/react-native package works differently, so check which one you’re on.

3. The payload format is already defined.
The SDK sends Amplitude’s HTTP API v2 format (api_key, an events array, client_upload_time), and it generates an insert_id for each event. That gives the collector both clock-skew correction and deduplication for free.

Give instance B a separate api_key for each app, which the collector uses to tell sources apart. It’s not a secret; it’s an identifier.
4. Over-the-air updates (if you use EAS Update or CodePush).
trackInternal() calls are JavaScript, so fixes can ship without a store release. The usual “old app versions stay around for months” problem gets much smaller for event code. Native-level changes still need a store release.

What to handle carefully
Keep identity in sync between the two instances. The wrapper must keep both instances consistent:

Device ID: set instance B’s device ID from instance A’s at startup.
User ID: call setUserId on both at login and logout (including null at logout).
Session ID: either share instance A’s session ID with B, or accept separate sessions. Sharing is better, so events from both systems line up per session.
Check the offline storage limit. This is the important one.
The RN SDK stores its queue in AsyncStorage by default. On Android, AsyncStorage historically has a total size limit of about 6 MB per app, shared by everything stored there. At roughly 1 KB per event, that’s only a few thousand queued events, which may be short of the 12-hour outage budget you locked.

Check the actual limit for your AsyncStorage version and setup, and how much space each Amplitude instance uses.
If it’s too small, either raise Android’s AsyncStorage database size setting or plug in a custom storage provider (the SDK allows this), for example one backed by MMKV or SQLite.
Principle: an SDK’s buffer is only as big as the storage underneath it. Check the actual storage layer, not just the SDK’s settings.

Updated open checks
 Confirm the app uses @amplitude/analytics-react-native (the newer SDK), not the legacy package
 The wrapper keeps device ID, user ID and session ID in sync between the two instances
 Measure the Android AsyncStorage limit; switch to a custom storage provider if it can’t hold about 12 hours of events
 A separate api_key per app for instance B
And from the previous message, the web app decisions are still open: registry in DynamoDB, the events pull CLI, Next.js on Fargate with SSO, the MVP pages, and charts that never run live Athena queries. Confirm those, and I’ll add both updates to the design doc.

Help me understand why we need "collectors reload it (poll about every 60 s)" if a pipeline is writing registry somewhere then we should be able to live read it easily or tell collector somehow instead of polling every 60s and keep polling for life.

Good question. It comes down to two separate problems: where the collector reads the registry from on each request, and how its copy stays up to date.

Why not read it live on every request?
The collector needs the registry for every request: validating events, applying PII actions, flagging unregistered events. Reading DynamoDB or S3 per request would:

Add latency to every ingestion call: a network round trip, versus a memory lookup measured in microseconds.
Cost money, since it happens millions of times a month.
Put a new dependency on the critical path. If DynamoDB is slow or throttled, ingestion slows down or fails. That breaks your rule that nothing should block ingestion.
So the collector keeps the registry in memory. The real question is how to keep that in-memory copy fresh: push or poll.

Push vs. poll
Approach	How it works	Weakness
Poll	Every 60 seconds, each collector checks “has the version changed?”	Up to 60 seconds of staleness
Push	On a change, notify every collector immediately	Notifications can be lost. A task that’s restarting, disconnected or mid-deploy misses the message and stays stale indefinitely, with nothing to catch it.
Key insight: reliable push systems still use periodic polling as a safety net. Kubernetes watches resync periodically, DNS has TTLs, and AWS AppConfig’s agent polls. Use push for speed and polling for correctness.

“Polling forever” costs almost nothing
The poll is a version check, not a download: a Redis GET registry_version (well under a millisecond), or an S3 request that returns “not modified” when nothing changed.
With 4 tasks checking once a minute, that’s about 170k requests a month, pennies or less.
It only downloads the full snapshot when the version actually changed, which happens a few times a day.
Recommendation: notify, then pull, with polling as backup
Web app saves → DynamoDB Stream → Lambda:
    1. writes registry snapshot v42 to S3 (versioned JSON)
    2. publishes "registry:updated v42" via Redis pub/sub (you already run Valkey)

Collector:
    • On startup: load the latest snapshot (if it can't, refuse to start serving)
    • On a pub/sub message: fetch v42 → validate it → swap it in (instant)
    • Every 60 s: compare versions → fetch if behind (catches missed messages)
    • If a fetch fails: keep the last good copy, raise an alarm, never serve empty
Swap the registry in atomically: build the new copy in full, then replace the reference in one step, the same pattern as Iceberg’s pointer swap. A request uses either the old registry or the new one, never a half-loaded mix.

Does 60 seconds of staleness even matter?
Mostly not, which is why this design is safe:

Change	Effect of being stale for up to 60 s
An event gets approved	None. Registration status is worked out at query time from the registry table, not from collector flags.
A property’s type changes	A few events get flagged against the old schema version, and _schema_version records which one
A property is marked as PII	This is the only case that matters. PII could be stored for up to 60 seconds. Push makes it near-instant, and the collector’s pattern-based masking of suspected PII covers the gap.
Principle: keep config the hot path needs local (fast, and no dependency), use a push notification for speed, a cheap periodic check for correctness, and an atomic swap for safety. The same pattern applies to feature flags, routing tables and certificates.

To lock:
The registry snapshot lives in S3. The Lambda publishes a version notice over Redis pub/sub, and collectors also check the version every 60 seconds.
Atomic swap, keep the last good copy on failure, and refuse to serve traffic until a snapshot loads.
That plus the earlier web app points (DynamoDB registry, the events pull CLI, Next.js on Fargate with SSO, MVP pages, no live Athena for charts) are all that’s left to lock before I update the doc.

Then just polling is fine, let's not add another layer of push

Agreed: polling only. It’s simpler, and it already handles every failure case on its own.

Locked:

The registry snapshot lives in S3 as versioned JSON, written by the Lambda that the DynamoDB Stream triggers.
Collectors check the version every 60 seconds and download the full snapshot only when it has changed.
Atomic swap, keep the last good copy on failure, raise an alarm if it falls behind, and refuse to serve traffic until a snapshot loads.
The one trade-off you’re accepting: a newly marked PII property can still be stored for up to 60 seconds. Two cheap ways to reduce that if it worries you:

Shorten the check to 15–30 seconds. Cost is still negligible: about 700k requests a month at 15 seconds, well under a dollar.
The collector’s pattern-based masking of suspected PII (emails, phone numbers) covers most of that window anyway.
Principle: don’t add a second mechanism until the first one’s weakness actually costs you something. Polling’s only weakness here is a small delay, and the system already tolerates it.

The other web app points are still pending:

DynamoDB registry with a change log; no PR process.
The events pull CLI generates the single TypeScript types file.
Next.js on Fargate behind a separate load balancer with OIDC sign-in.
MVP pages: catalog, review queue, data quality, health, cost.
Charts read from CloudWatch and a pipeline-written stats table, never live Athena.
Confirm these and I’ll add the web app, registry and React Native SDK updates to the design doc.

what is this: The events pull CLI generates the single TypeScript types file.

It’s a small command-line tool that turns the registry in your web app into TypeScript types your React Native code can use. That’s how the compiler stops wrong events from being sent.

Why it’s needed
The registry now lives in the web app’s database. Your app code lives in the repo. TypeScript can only check code against types that exist in the repo, so something has to bring the registry into the codebase. That’s events pull.

What it does
Web app (DynamoDB registry)
        │  events pull  (calls the registry API)
        ▼
src/analytics/internalEvents.generated.ts   ← one file, never edited by hand
        │
        ▼
trackInternal() uses these types → the editor autocompletes, and mistakes fail to compile
What the generated file contains (illustrative):

ts
export type InternalEvents = {
  checkout_retry: { attempt: number; error_code: string };
  app_crash:      { screen: string; error_code?: string };
};
What developers get:

trackInternal('checkout_rety', …) (a typo) → compile error.
trackInternal('checkout_retry', { attempt: '2' }) (wrong type) → compile error.
Autocomplete for event names and their properties, right in the editor.
Properties marked drop can be left out of the types entirely, so developers can’t even try to send them.
The developer workflow
Add or approve the event in the web app.
Run events pull locally, and the generated file updates.
Use the new event in code, with autocomplete.
How Amplitude does it: this is the same as Amplitude’s ampli pull, which generates a typed SDK from its tracking plan.

One decision: commit the generated file, or generate it at build time?
Option	Pros	Cons
Commit it to the repo	Builds are reproducible, and they don’t depend on the registry API being up. Changes show up in PR diffs.	You need a CI check that it’s up to date
Generate during every build	Always current	Builds break if the API is down, and the same commit can produce different types on different days
Recommendation: commit it. Add a CI step that runs events pull and fails the build if the file changes, which means someone forgot to pull. It’s the same practice as committing a lockfile.

Principle: generated code that a build depends on should be checked in and verified, not fetched live. Builds should be deterministic and not need the network.

Do you want to lock “commit the generated file, plus a CI freshness check,” along with the other web app points?

But we agreed that we will keep it free form on the client side to send the events and if there is new event or properties we will handle with registry on the backend.

You’re right. I layered compile-time types on top, and that contradicts the free-form client you asked for in Decision 1. Let’s fix that properly.

Your model: free-form client, governance on the backend
The client sends any event name and any properties: trackInternal(name: string, props: Record<string, unknown>).
The registry lives only on the backend. New events and properties show up in the web app’s review queue, where they get approved, marked as PII, or ignored.
No codegen, no events pull, no build dependency, no CI checks. That’s exactly how Amplitude behaves by default.
What moves to the backend when the compiler no longer enforces anything:

Protection	Before (typed)	Now (free-form)
Typos (checkout_rety)	Compile error	Appears in the review queue as a new event. Add an alias there (checkout_rety → checkout_retry), and silver views merge the two.
Wrong property types	Compile error	Collector flags it (_invalid), and it shows up on the data quality page
PII sent by mistake	Couldn’t be sent	The collector drops or hashes it based on the registry, plus pattern masking for unregistered events. This is now the main safeguard, so it has to be solid.
track() vs trackInternal() routing	Enforced by type sets	Documentation: JSDoc and CLAUDE.md (what you originally suggested)
Principle: checks move but don’t disappear. Without compile-time checks, the collector and the review queue become the enforcement point, so they need to be reliable.

Optional middle ground: autocomplete without enforcement
If you want help in the editor without losing free-form, generate hints instead of rules:

Known event names autocomplete, but any string is still accepted. This uses a TypeScript pattern that keeps suggestions while allowing new values.
Known properties autocomplete, and extra properties are still allowed.
It never fails a build, and the hints file can be stale without breaking anything.
That removes most typos without slowing anyone down. It’s purely a convenience, and easy to add later.

To lock:
Free-form client (trackInternal(name, props)), with the registry on the backend only. Drop the typed event sets, the required events pull, and the CI freshness check.
Aliases in the registry for typos and renames, applied in silver views.
Routing guardrails through documentation (JSDoc, CLAUDE.md).
Autocomplete hints: skip for now, or add as an optional convenience?
Once you confirm, I’ll update the design doc: the web app and registry, React Native SDK details, polling-based registry reload, and this free-form correction.

Yes approve

I’ll update the design doc now. I’m treating autocomplete hints as skipped for now, and the five web app points as approved.


Read doc
Read doc
Updating the client SDK section for the free-form client and React Native details.


Edit doc
Edit doc
Now the governance section, plus a new web app section.


Edit doc
Edit doc
Now the cost estimate, the checklist and the decision log.


Edit doc
Edit doc
The design doc now reflects the latest decisions:

Client: trackInternal(name, props) accepts any event name and properties, so there’s no type generation, no events pull, and no CI check on the registry.
React Native SDK: the identity-sync rules for the two instances, plus the Android storage limit on the offline queue.
Registry: lives only in the backend, with aliases for typos and renames, and stricter PII defaults.
New web app section: the pages, the architecture, and collectors polling the registry every 60 seconds.
Cost, checklist and decision log: updated to match.
Autocomplete hints are listed as an optional later step, not part of the design.

Do we have the system for sending a config or something from backend to mention some events needs to move from Amplitude to Internal events for the old events.

Not yet. We decided there would be a one-way remote migration list, but never designed how it reaches the app. Here’s a design that builds on what we already have.

How it works
Web app: "Move to internal" button on an Amplitude event (one-way, needs confirmation)
    │  DynamoDB Stream → Lambda
    ▼
routing.json snapshot in S3 → served through the existing CloudFront (cached ~5 min)
    │  app fetches it on start + when returning to the foreground (at most every few hours)
    ▼
RN wrapper: track('cart_viewed') → name is in the migrated set → sent via instance B instead
The wrapper’s behaviour:

track(name, props) checks the migrated set. If the name is in it, the event goes to instance B (ours) with the same payload, so the collector receives the format it already accepts.
Fallbacks, in order: a freshly fetched list → the last list cached on the device (AsyncStorage or MMKV) → a default list bundled in the app. A network failure never resets routing.
One-way is enforced in the web app: there’s no “move back” action.
In the web app:

Import the list of Amplitude event names (exported from Amplitude), so the catalog shows Amplitude events alongside internal ones.
Each Amplitude event shows its volume and estimated monthly Amplitude cost, next to a “Move to internal” button. The team can then pick the highest-volume engineering events first, and see the savings before acting.
Edge cases to plan for
Issue	Handling
App versions older than the wrapper keep sending to Amplitude	Migration only applies to app versions that include the routing logic, so Amplitude cost falls as people update. Optionally block those events in Amplitude to stop the cost sooner (old versions’ data for those events is then lost). Check whether blocked events count toward Amplitude’s billed volume.
History gets split across two systems	The registry records migrated_at for each event: data before that date is in Amplitude, after it is internal. Show this on the catalog page.
The changeover itself	Devices pick up the new list at different times, so expect a few hours where some devices send to Amplitude and others to us. Nothing is duplicated; the data is just split. migrated_at is approximate.
The list is public	It’s served through CloudFront without sign-in. It holds event names only, no secrets, so that’s fine.
Cost: close to zero. One small JSON file, served from cache, fetched a few times per device each day.

How Amplitude does it: Amplitude can deliver remote config through its own feature-flag product (Amplitude Experiment). It could do the job, but it would make your migration away from Amplitude depend on Amplitude. A small file you serve yourself keeps this independent.

Principle: remote config should always have a last known good fallback on the device and a safe default in the app bundle. A config fetch must never be the thing that changes behaviour by accident.

One question before locking: do you already have a remote config or feature flag system in the app (Firebase Remote Config, or your own experimentation system)? If so, using it for this list might be better than adding routing.json.

we have remote config

Use your existing remote config. It already gives you the hard parts: the device caches the last fetched values, the app ships with built-in defaults, and you probably already monitor it. That’s the “last known good plus safe default” pattern for free.

Revised design
One remote config key, for example analytics_internal_events, holding a list of event names.
The RN wrapper reads the key from the remote config SDK. If track(name) matches a name in the list, the event goes to instance B with the same payload.
Default value in the app bundle: an empty list, or whatever has already been migrated when you release.
The web app stays the place where decisions are made: it shows volume and estimated Amplitude cost per event, records migrated_at, and enforces the one-way rule.
Drop routing.json, its Lambda and the CloudFront path. There’s nothing new to run.
Points to check against your remote config system
Check	Why it matters
How often devices fetch	Many systems cache aggressively. Firebase, for example, defaults to fetching at most every 12 hours in production. That’s fine here, since migration is one-way and not urgent, but expect it to take that long for devices to switch over.
Value size limit	A list of names is small, but check it as the list grows. Short names, or one list per app, keep it safe.
Who can edit the key	The one-way rule is only real if people can’t edit the key directly and remove entries. Restrict who can edit it, or make the web app the only writer.
One decision: how the web app updates remote config
Option	How it works	Trade-off
Automatic	“Move to internal” calls the remote config admin API and appends the event name	One-click, and enforces one-way. Needs API credentials stored in Secrets Manager.
Manual	The web app records the decision and shows “add cart_viewed to analytics_internal_events” for someone to do by hand	Nothing to integrate, but someone can forget, and the web app and remote config can drift apart
Recommendation: automatic, if your remote config has an admin API (most do, including Firebase). Use the manual approach only if API access is hard to get.

Principle: reuse existing platform capabilities before building new ones. Your remote config already solves caching, defaults and rollout. Your job is to make the web app the single place where migration decisions are made.

Which remote config system is it, and should the web app update it automatically or should someone do it by hand? I’ll add this to the doc once you confirm.

just make a note of remote config update, how to do it should be done after looking at the system how remote config is working. Update the design doc.


Used Claude Docs integration, read a file
Used Claude Docs integration, read a file
The design doc now has a “Migrating existing events” section. It covers reusing your existing remote config, the wrapper’s routing check, the “Move to internal” action in the web app, and history split by migrated_at. It also includes a note that how the web app updates remote config will be decided after reviewing that system. The verification checklist now includes reviewing the remote config system and checking whether events blocked in Amplitude still count toward billed volume.

I would prefer to do it by hand


Used Claude Docs integration, read a file
Used Claude Docs integration, read a file
I’ve updated the design doc: remote config is now edited by hand. In the web app, “Move to internal” records the decision and creates a pending task for someone to add the event name to the remote config key and mark it done.

One addition, since nothing enforces the manual step automatically: a drift check based on the data. If an event is marked migrated but is still arriving only in Amplitude about 3 days later, the Slack digest flags it. That catches a forgotten edit without connecting to the remote config API. Edit access to the key stays limited to the tech team, so the one-way rule holds.

webapp is not required for this move to internal if we are going with manual


Read 2 files, used Claude Docs integration
Read 2 files, used Claude Docs integration
Agreed. If the remote config is edited by hand, the web app adds nothing to this step. I’ve updated the design doc:

Migration is entirely manual: the tech team adds event names to the remote config key. Edit access is limited to that team, and entries are only ever added, which keeps the move one-way.
The migration date comes from the data: an event’s first_seen_at in our pipeline marks when it moved, so nothing has to be recorded by hand.
The web app’s role is removed: no Amplitude event import, no “Move to internal” button, no pending tasks, no drift check. Migrated events simply show up in the catalog and review queue once they start arriving, like any other event.
Principle: if a process is manual, keep the tooling around it minimal too. Take the facts you need (like the migration date) from the system’s own data rather than asking people to record them.
