# gRPC client retry policy

The current KurrentDB client (gRPC) has no built-in retries. The legacy TCP client (`EventStore.ClientAPI` / `EventStoreConnection`) had silent retries baked into `ConnectAsync` and the operation queue. Every transient gRPC failure now surfaces to the caller. Any application using the gRPC client needs an explicit retry layer; treat its absence as a reliability regression, not a style choice.

The contract below is **language-neutral**: which gRPC status codes are retryable, the idempotency rule for appends, and the reconnect pattern for subscriptions. The .NET recipe at the bottom implements the contract for `KurrentDB.Client`; recipes for other languages will land here as they are authored.

## What is retryable

Retry decisions are made against the gRPC `Status.Code` returned by the server, plus a small set of typed exceptions raised by the SDK. Both surfaces are consistent across language clients.

| Failure                                                      | Retry?                       | Why                                                                              |
|--------------------------------------------------------------|------------------------------|----------------------------------------------------------------------------------|
| `Status.UNAVAILABLE`                                         | **yes**                      | Transport-level transient (network blip, node restart).                          |
| `Status.DEADLINE_EXCEEDED`                                   | **yes, with backoff**        | Server is slow or under load.                                                    |
| `Status.RESOURCE_EXHAUSTED`                                  | **yes, with longer backoff** | Server is rate-limiting or memory-pressured.                                     |
| `Status.ABORTED`                                             | **yes**                      | Concurrency conflict at the gRPC layer (rare for KurrentDB; treat as transient). |
| `NotLeaderException` / leader-redirect signal (cluster mode) | **handled by client**        | The SDK transparently re-routes to the current leader; do not double-wrap.       |
| `Status.INTERNAL`                                            | **at most once**             | Could be a server bug; do not loop.                                              |

## What is **not** retryable

| Failure                                                                   | Retry?                         | Why                                                                                                                                    |
|---------------------------------------------------------------------------|--------------------------------|----------------------------------------------------------------------------------------------------------------------------------------|
| `WrongExpectedVersionException` (or the SDK's equivalent typed exception) | **never**                      | The stream moved past the expected revision. Retrying with the same revision will fail forever. Re-read state and rebuild the command. |
| `StreamDeletedException`                                                  | **never**                      | Semantic. The stream is gone.                                                                                                          |
| `AccessDeniedException` / `Status.PERMISSION_DENIED`                      | **never**                      | Auth issue. Retrying makes it worse (rate limit / lockout).                                                                            |
| `Status.UNAUTHENTICATED`                                                  | **never via the retry policy** | Refresh the credential and retry once at most, out of band from the transient-retry pipeline.                                          |
| `StreamNotFoundException` (reads)                                         | **never**                      | Semantic. Either the stream exists or it does not.                                                                                     |
| Validation exceptions from application code                               | **never**                      | Not a transport issue.                                                                                                                 |

## Idempotency contract for appends

KurrentDB appends are idempotent **on event id** (named `Uuid` in .NET, `id` in Node and Python, `UUID` in JVM, `uuid.UUID` in Go, etc.). Replaying the exact same event with the same id to the same stream is safe: the server accepts the first one and rejects (or silently dedupes; behaviour is version-dependent) the duplicate.

This matters because a transient `UNAVAILABLE` may occur **after** the server accepted the write but **before** the response reached the client. Retrying with the same id and the same payload preserves at-most-once semantics. **Always reuse the same event id across retries.** Constructing a fresh id on each retry turns transient failures into duplicated events.

The shape of this rule in pseudocode:

```
// ✅ DO: capture id once, reuse across retries
id = newId()
evt = makeEvent(id, type, payload)
retryPolicy.execute(() => client.appendToStream("order-7", expectedRevision, [evt]))

// ❌ DON'T: regenerate id inside the retry (duplicates on second attempt)
retryPolicy.execute(() => {
  evt = makeEvent(newId(), type, payload)   // bug
  return client.appendToStream("order-7", expectedRevision, [evt])
})
```

The contract is the same in every SDK; the .NET recipe below shows the concrete form.

## Subscriptions: reconnect, do not retry

Catch-up and persistent subscriptions are **long-lived**. Wrapping the subscribe call itself in a retry policy does not help; the right shape is a reconnect loop that resumes from the last processed position.

Shape (pseudocode):

```
async runSubscription(client, resumeFrom):
  while not cancelled:
    try:
      subscription = client.subscribeToStream("order-7", from: resumeFrom)
      for msg in subscription:
        if msg is Event:
          handle(msg.event)
          resumeFrom = msg.event.originalRevision   // checkpoint AFTER success
    catch transient (UNAVAILABLE / DEADLINE_EXCEEDED):
      sleep(backoff)
      // loop reconnects from the checkpoint
    catch cancelled:
      raise
```

**Persist `resumeFrom` to durable storage** (event store, file, DB) so the loop survives process restarts, not just transient drops. The legacy TCP client did this for you internally; the gRPC client makes it the application's responsibility.

## Reviewer checks

`code-reviewer` (post-migration mode) flags as **WARN** any project that:

1. Migrated to the current gRPC client but has zero references to a retry library (Polly / `ResiliencePipeline` for .NET, `cockatiel` or `p-retry` for Node, Resilience4j for JVM, `tenacity` for Python, `failsafe-go` for Go, the `backoff` crate for Rust, or an equivalent).
2. Wraps appends in a retry without preserving the event id across attempts.
3. Wraps a `subscribeToStream` / `subscribeToAll` call in a retry policy (wrong layer; should be a reconnect loop with checkpoint persistence).

A retry layer is not optional for production migrations. Treat the absence as a regression and add the pipeline before declaring the migration done.

---

## .NET recipe (Polly v8 / Microsoft.Extensions.Resilience)

Implementation of the contract above for the .NET `KurrentDB.Client`. Recipes for other languages are not authored yet; apply the contract to your SDK's idiomatic resilience library and follow the same shape.

### Library choice

Polly v8 (`Microsoft.Extensions.Resilience`) is the current .NET standard. Wire one resilience pipeline per gRPC operation kind and inject it via DI. Do not use the older `Polly` v7 `IAsyncPolicy<T>` surface in new code; the v8 pipeline API is what the .NET 8+ Microsoft.Extensions stack integrates with.

### Package reference

```xml
<ItemGroup>
  <PackageReference Include="Microsoft.Extensions.Resilience" Version="9.*" />
  <PackageReference Include="Microsoft.Extensions.Http.Resilience" Version="9.*" />
</ItemGroup>
```

### Pipeline registration (`Program.cs`)

```csharp
using Grpc.Core;
using KurrentDB.Client;
using Microsoft.Extensions.Resilience;
using Polly;
using Polly.Retry;

builder.Services.AddResiliencePipeline("kurrentdb-write", pipeline =>
{
    pipeline.AddRetry(new RetryStrategyOptions
    {
        ShouldHandle = new PredicateBuilder()
            .Handle<RpcException>(ex => ex.StatusCode is
                StatusCode.Unavailable or
                StatusCode.DeadlineExceeded or
                StatusCode.ResourceExhausted or
                StatusCode.Aborted),
        MaxRetryAttempts = 5,
        Delay = TimeSpan.FromMilliseconds(200),
        BackoffType = DelayBackoffType.Exponential,
        UseJitter = true,
    });
    pipeline.AddTimeout(TimeSpan.FromSeconds(30));
});

builder.Services.AddResiliencePipeline("kurrentdb-read", pipeline =>
{
    pipeline.AddRetry(new RetryStrategyOptions
    {
        ShouldHandle = new PredicateBuilder()
            .Handle<RpcException>(ex => ex.StatusCode is
                StatusCode.Unavailable or
                StatusCode.DeadlineExceeded),
        MaxRetryAttempts = 3,
        Delay = TimeSpan.FromMilliseconds(100),
        BackoffType = DelayBackoffType.Exponential,
        UseJitter = true,
    });
});

builder.Services.AddKurrentDBClient(builder.Configuration.GetConnectionString("KurrentDB"));
```

### Use at the call site (preserving `Uuid` across retries)

```csharp
public class OrderRepository(
    KurrentDBClient client,
    ResiliencePipelineProvider<string> pipelines)
{
    readonly ResiliencePipeline _write = pipelines.GetPipeline("kurrentdb-write");
    readonly ResiliencePipeline _read  = pipelines.GetPipeline("kurrentdb-read");

    public async Task AppendAsync(
        string streamId,
        StreamRevision expected,
        string eventType,
        ReadOnlyMemory<byte> payload,
        CancellationToken ct)
    {
        // ✅ Uuid created ONCE, outside the retry, reused on every attempt.
        var eventId = Uuid.NewUuid();
        var evt     = new EventData(eventId, eventType, payload);

        await _write.ExecuteAsync(async token =>
            await client.AppendToStreamAsync(streamId, expected, new[] { evt }, cancellationToken: token),
            ct);
    }

    public async Task<List<ResolvedEvent>> ReadAsync(string streamId, CancellationToken ct) =>
        await _read.ExecuteAsync(async token =>
        {
            var result = client.ReadStreamAsync(Direction.Forwards, streamId, StreamPosition.Start, cancellationToken: token);
            return await result.ToListAsync(token);
        }, ct);
}
```

**Never construct `Uuid.NewUuid()` inside the `ExecuteAsync` body.** Each retry attempt would generate a fresh id, and a transient that occurs after the server accepted the write would append a duplicate.

### Subscriptions: reconnect loop, not a retry policy

```csharp
async Task RunSubscription(KurrentDBClient client, StreamPosition resumeFrom, CancellationToken ct)
{
    while (!ct.IsCancellationRequested)
    {
        try
        {
            await using var subscription = client.SubscribeToStream(
                "order-7", FromStream.After(resumeFrom), cancellationToken: ct);

            await foreach (var msg in subscription.Messages.WithCancellation(ct))
            {
                if (msg is StreamMessage.Event(var evt))
                {
                    await Handle(evt, ct);
                    resumeFrom = evt.OriginalEventNumber; // checkpoint after success
                }
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (RpcException ex) when (ex.StatusCode is StatusCode.Unavailable or StatusCode.DeadlineExceeded)
        {
            await Task.Delay(TimeSpan.FromSeconds(1), ct); // backoff before reconnect
        }
    }
}
```

Persist `resumeFrom` to durable storage (KurrentDB itself, a file, or a side database). The TCP client did this internally; with the gRPC client it is the application's responsibility.

### Reviewer checks specific to .NET

On top of the language-neutral reviewer checks above, the reviewer additionally flags .NET projects when:

- `Microsoft.Extensions.Resilience` and / or `Microsoft.Extensions.Http.Resilience` is not referenced.
- An `AppendToStreamAsync` / `ReadStreamAsync` / `ReadAllAsync` call site is not reached through a `ResiliencePipeline.ExecuteAsync(...)`.
- A `Uuid.NewUuid()` call appears inside an `ExecuteAsync` lambda body.
- `SubscribeToStream` / `SubscribeToAll` is wrapped in a `ResiliencePipeline` instead of a `while (!ct.IsCancellationRequested)` reconnect loop.
