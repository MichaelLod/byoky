package com.byoky.app.proxy

import android.content.Context
import com.byoky.app.data.ApiKeyFormat
import com.byoky.app.data.AuthMethod
import com.byoky.app.data.Credential
import com.byoky.app.data.Group
import com.byoky.app.data.Provider
import com.byoky.app.data.RoutingDecision
import com.byoky.app.data.RoutingTranslation
import com.byoky.app.data.UsageLedger
import com.byoky.app.data.UsageMeter
import com.byoky.app.data.WalletStore
import okhttp3.Call
import okhttp3.Headers.Companion.toHeaders
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONObject
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Proxies provider calls for apps running on this device. The app never sees
 * a key: it sends the request it would have sent to the provider, and this
 * class resolves routing (group binding, cross-family translation, same-family
 * swap), injects the decrypted credential and forwards the call.
 *
 * Callers:
 *   - [forward]: streaming entry point used by the in-wallet browser bridge
 *     (`runtime/AppBridge.kt`).
 *   - [proxyRequest]: buffered convenience wrapper (instrumented tests).
 *
 * All methods block on network I/O and on the JS translation sandbox, so
 * they must be called off the main thread.
 */
class ProxyService(
    private val wallet: WalletStore,
    private val appContext: Context? = null,
) {
    /**
     * The translation engine. Lazy because constructing it requires an
     * Android Context for JavaScriptSandbox. Without a context, routing
     * degrades to direct credential lookup (no translation or swaps).
     */
    private val translationEngine: TranslationEngine? by lazy {
        appContext?.let { TranslationEngine.get(it) }
    }

    private val client = newUpstreamClient()

    /**
     * Receives one proxied response. [onMeta] is called once, then any number
     * of [onChunk] (text) or [onBytes] (binary) calls, then [onDone]. Methods run on the calling thread;
     * throwing from any of them aborts the transfer and closes the upstream
     * connection.
     */
    interface ResponseSink {
        /** The upstream call, before it starts; cancelling it aborts the transfer. */
        fun onCall(call: Call) {}
        fun onMeta(status: Int, statusText: String, headers: Map<String, String>)
        fun onChunk(chunk: String)
        /** Raw bytes of a binary (non-text, see [ResponseChunks.isText]) response. */
        fun onBytes(chunk: ByteArray)
        fun onDone()
    }

    /**
     * A request that was rejected before reaching the provider. The status
     * follows the code, as the extension and iOS send it ([statusFor]).
     */
    class ProxyError(val code: String, message: String, val status: Int = statusFor(code)) : IllegalStateException(message)

    /**
     * Forward one request. `url` is the full provider URL the app asked for;
     * it must belong to `providerId` and be an inference or model-listing
     * endpoint (both checked here). Routing uses the group bound to
     * `appOrigin`; usage counts against that origin's allowance and the
     * request is logged under it. [binaryBody]: the body is base64 or form
     * data from the app, which can't be translated.
     *
     * Throws [ProxyError] when the request can't be routed (unknown provider,
     * URL mismatch, endpoint not allowed, allowance exceeded, no credential).
     * Any other exception is a transport or translation failure; its text is
     * never meant for the app (see `runtime/PageError`).
     */
    fun forward(
        appOrigin: String,
        providerId: String,
        url: String,
        method: String,
        headers: Map<String, String>,
        body: ByteArray?,
        sink: ResponseSink,
        binaryBody: Boolean = false,
    ) {
        wallet.noteActivity()
        val provider = Provider.find(providerId) ?: throw unknownProvider(providerId)

        val parsedUrl = url.toHttpUrlOrNull()
            ?: throw ProxyError("INVALID_URL", "URL doesn't parse")
        // Host-only check for now; for providers without a fixed host the
        // URL is checked against the credential routing picks (forwardDirect).
        if (!UpstreamPolicy.requestUrlAllowed(provider, parsedUrl)) {
            throw ProxyError("INVALID_URL", "URL doesn't match provider $providerId")
        }
        if (!EndpointPolicy.isAllowed(method, url)) throw endpointNotAllowed()

        // Admitting reserves an estimate, so parallel requests can't all pass
        // the check against the same remaining allowance.
        val reservation = when (val admission = wallet.admitRequest(appOrigin, providerId, body, binaryBody)) {
            is UsageLedger.Admission.Denied -> throw ProxyError("QUOTA_EXCEEDED", admission.reason)
            is UsageLedger.Admission.Allowed -> admission.reservation
        }
        val group = wallet.groupForOrigin(appOrigin)
        var routing: RoutingDecision? = null
        var exchange: Exchange? = null
        try {
            val credentials = wallet.credentials.value
            val decision = resolveRouting(providerId, parsedUrl, body, group, credentials)
                ?: throw ProxyError("PROVIDER_UNAVAILABLE", noCredentialMessage(providerId, credentials, group))
            routing = decision
            val upstreamProviderId = decision.translation?.dstProviderId ?: decision.swapToProviderId ?: providerId
            if (decision.translation != null || decision.swapToProviderId != null) {
                // Routing rewrites the request onto the destination's chat
                // endpoint, so only chat requests can be routed. Token counts,
                // embeddings or model lists would turn into billed generations.
                if (translationEngine?.isChatEndpoint(providerId, url) != true) {
                    throw ProxyError(
                        "ROUTING_UNSUPPORTED",
                        "This app is routed to $upstreamProviderId, and only chat requests can be routed to another provider",
                    )
                }
            }
            if (decision.translation != null && binaryBody) {
                throw ProxyError("TRANSLATION_NOT_SUPPORTED", "Cross-family routing does not support binary request bodies.")
            }

            // Usage is read in the dialect of the provider actually called.
            val ex = Exchange(UsageMeter(upstreamProviderId).also { it.requestBytes = body?.size?.toLong() ?: 0 })
            exchange = ex
            when {
                decision.translation != null -> forwardTranslated(
                    parsedUrl, decision.translation, decision.credential, method, headers, body, sink, ex,
                )
                decision.swapToProviderId != null -> forwardSwapped(
                    providerId, parsedUrl, decision.swapToProviderId, decision.swapDstModel,
                    decision.credential, method, headers, body, sink, ex,
                )
                else -> forwardDirect(
                    provider, parsedUrl, decision.credential, decision.modelOverride,
                    method, headers, body, sink, ex,
                )
            }
        } finally {
            // Also when the transfer failed part-way (app cancelled or closed,
            // connection dropped, translation error): the provider bills
            // whatever it already did.
            settle(appOrigin, providerId, parsedUrl, method, body, binaryBody, group, routing, reservation, exchange)
        }
    }

    /** One upstream call and what is known about it so far. */
    private class Exchange(val meter: UsageMeter) {
        var call: Call? = null
        var upstreamUrl: String? = null
        /** The request went out (it wasn't cancelled before it started). */
        var sent = false

        /** Hand [call] to the sink (which may cancel it) and run it. */
        fun execute(call: Call, url: String, sink: ResponseSink): Response {
            this.call = call
            upstreamUrl = url
            sink.onCall(call)
            if (call.isCanceled()) throw IOException("Canceled before sending")
            sent = true
            return call.execute().also { response ->
                meter.status = response.code
                meter.contentType = response.header("content-type").orEmpty()
            }
        }
    }

    /**
     * Count what a finished, failed or cancelled request used against the
     * app's allowance, release its reservation and log it. Totals first, so
     * anything observing the log sees them updated. Mirrors the extension.
     */
    private fun settle(
        appOrigin: String,
        providerId: String,
        appUrl: HttpUrl,
        method: String,
        body: ByteArray?,
        binaryBody: Boolean,
        group: Group?,
        routing: RoutingDecision?,
        reservation: UsageLedger.Reservation,
        exchange: Exchange?,
    ) {
        val meter = exchange?.meter
        val call = exchange?.call
        val (status, counted) = when {
            exchange == null || meter == null || call == null || !exchange.sent -> {
                // Never reached the provider.
                wallet.settleUsage(reservation, null)
                return
            }
            meter.status != 0 -> {
                val upstreamProviderId = routing?.translation?.dstProviderId ?: routing?.swapToProviderId ?: providerId
                val estimate = EndpointPolicy.shouldEstimateUsage(upstreamProviderId, appUrl, meter.contentType)
                meter.status to meter.counted(estimate)
            }
            // The app cancelled after the request went out but before the
            // response headers (for a non-streaming reply, before generation
            // ended): the provider still bills, so charge its estimate.
            call.isCanceled() -> CANCELLED_STATUS to cancelledUsage(body, binaryBody)
            else -> {
                // Connection failed before any response.
                wallet.settleUsage(reservation, null)
                return
            }
        }
        wallet.settleUsage(reservation, counted)
        try {
            wallet.logRequest(
                appOrigin = appOrigin,
                providerId = providerId,
                method = method,
                url = exchange.upstreamUrl ?: appUrl.toString(),
                statusCode = status,
                requestBody = if (binaryBody) null else body,
                usage = counted,
                actualProviderId = routing?.translation?.dstProviderId ?: routing?.swapToProviderId,
                // A pin isn't applied to embeddings, audio and the like.
                actualModel = routing?.translation?.dstModel ?: routing?.swapDstModel
                    ?: routing?.modelOverride?.takeIf { EndpointPolicy.isModelPinnable(appUrl) },
                groupId = group?.id,
            )
        } catch (_: Exception) {
            // The log is for display; it must not mask the request's outcome.
        }
    }

    /** A request cancelled before any response: its prompt plus the output it asked for. */
    private fun cancelledUsage(body: ByteArray?, binaryBody: Boolean): UsageLedger.Usage {
        val total = UsageLedger.estimate(body, binaryBody)
        val input = if (body == null || binaryBody) 0 else UsageLedger.promptTokens(body)
        return UsageLedger.Usage(1, input, (total - input).coerceAtLeast(0))
    }

    /**
     * Buffered wrapper around [forward]: builds the URL from the provider's
     * base (or the credential's base for providers without a fixed host)
     * plus `path`, and returns the whole response at once.
     */
    fun proxyRequest(
        providerId: String,
        path: String,
        method: String,
        headers: Map<String, String>,
        body: ByteArray?,
        appOrigin: String = DEFAULT_ORIGIN,
    ): Response {
        val provider = Provider.find(providerId)
            ?: throw IllegalArgumentException("Unknown provider: $providerId")
        val base = if (provider.requiresCustomBaseUrl) {
            wallet.credentials.value.firstOrNull { it.providerId == providerId }?.baseUrl ?: provider.baseUrl
        } else provider.baseUrl
        val url = base.trimEnd('/') + path

        val collected = object : ResponseSink {
            var status = 0
            var statusText = ""
            var headers: Map<String, String> = emptyMap()
            val received = java.io.ByteArrayOutputStream()
            override fun onMeta(status: Int, statusText: String, headers: Map<String, String>) {
                this.status = status
                this.statusText = statusText
                this.headers = headers
            }
            override fun onChunk(chunk: String) { received.write(chunk.toByteArray(Charsets.UTF_8)) }
            override fun onBytes(chunk: ByteArray) { received.write(chunk) }
            override fun onDone() {}
        }
        forward(appOrigin, providerId, url, method, headers, body, collected)

        val contentType = collected.headers["content-type"] ?: "application/json"
        return Response.Builder()
            .request(Request.Builder().url(url).build())
            .protocol(Protocol.HTTP_1_1)
            .code(collected.status)
            .message(collected.statusText)
            .headers(collected.headers.toHeaders())
            .body(collected.received.toByteArray().toResponseBody(contentType.toMediaTypeOrNull()))
            .build()
    }

    // ──────────────────────────────────────────────────────────────────────
    // Routing
    // ──────────────────────────────────────────────────────────────────────

    private fun resolveRouting(
        providerId: String,
        url: HttpUrl,
        body: ByteArray?,
        group: Group?,
        credentials: List<Credential>,
    ): RoutingDecision? {
        val engine = translationEngine
            // No engine: direct match only, still honoring the group's pinned key and model.
            ?: return RoutingResolver.resolveDirect(providerId, group, credentials)
        val srcModel = RoutingResolver.requestModel(providerId, url, body)
        return RoutingResolver.resolve(providerId, srcModel, group, credentials, families(engine))
    }

    /**
     * Whether a request for [providerId] from [appOrigin] can be served, and
     * with which key (see [RoutingResolver.canServe]). For the connect
     * response; without the translation engine only direct keys count, as
     * in [resolveRouting].
     */
    fun canServe(appOrigin: String, providerId: String): Credential? {
        val group = wallet.groupForOrigin(appOrigin)
        val credentials = wallet.credentials.value
        val engine = translationEngine ?: return RoutingResolver.resolveDirect(providerId, group, credentials)?.credential
        return RoutingResolver.canServe(providerId, group, credentials, families(engine))
    }

    /** Family questions answered by the bundled core. */
    private fun families(engine: TranslationEngine) = object : RoutingResolver.Families {
        override fun shouldTranslate(srcProviderId: String, dstProviderId: String) =
            engine.shouldTranslate(srcProviderId, dstProviderId)
        override fun sameFamily(srcProviderId: String, dstProviderId: String) =
            engine.sameFamily(srcProviderId, dstProviderId)
        override fun autoRouteModel(providerId: String) = engine.autoRouteModelFor(providerId)
    }

    /**
     * The decrypted key of [credential]. Keys added before printable ASCII
     * was enforced may still hold a stray character; OkHttp would reject
     * the header with an error quoting the value, so fail cleanly instead.
     */
    private fun apiKey(credential: Credential, providerName: String): String {
        val key = wallet.decryptKey(credential)
        if (!ApiKeyFormat.isValid(key)) throw unusableKey(providerName, credential.label)
        return key
    }

    /** The URL a request may go to with [credential]'s key, or a [ProxyError]. */
    private fun allowedTarget(provider: Provider, url: HttpUrl, credential: Credential): String =
        when (val t = UpstreamPolicy.target(provider, url, credential.baseUrl)) {
            is UpstreamPolicy.Target.Allowed -> t.url
            UpstreamPolicy.Target.MissingBaseUrl -> throw missingBaseUrl(provider.name, credential.label)
            UpstreamPolicy.Target.WrongHost ->
                throw ProxyError("INVALID_URL", "URL doesn't match the server registered for the ${provider.name} key \"${credential.label}\"")
        }

    /** Base URL for rewriteProxyUrl: none for fixed-host providers, else the credential's own. */
    private fun rewriteBase(dstProviderId: String, credential: Credential): String? =
        when (val o = UpstreamPolicy.rewriteOverride(dstProviderId, credential.baseUrl)) {
            UpstreamPolicy.Override.None -> null
            is UpstreamPolicy.Override.Base -> o.baseUrl
            UpstreamPolicy.Override.MissingBaseUrl ->
                throw missingBaseUrl(Provider.find(dstProviderId)?.name ?: dstProviderId, credential.label)
        }

    /**
     * Re-check a URL produced by the JS bundle's rewriteProxyUrl before any
     * key is attached, so a bundle that ignores the rules can't redirect it.
     */
    private fun checkedRewrite(dstProviderId: String, rewritten: String?, credential: Credential, method: String, code: String): String {
        val provider = Provider.find(dstProviderId)
            ?: throw ProxyError(code, "Unknown destination provider $dstProviderId")
        val parsed = rewritten?.toHttpUrlOrNull()
            ?: throw ProxyError(code, "No upstream URL for $dstProviderId")
        // The rewrite can carry the app's model into the path (Azure deployments).
        if (!EndpointPolicy.isAllowed(method, rewritten)) throw endpointNotAllowed()
        return allowedTarget(provider, parsed, credential)
    }


    // ──────────────────────────────────────────────────────────────────────
    // Paths
    // ──────────────────────────────────────────────────────────────────────

    /** Pass-through: same provider the app called, the user's own key. */
    private fun forwardDirect(
        provider: Provider,
        url: HttpUrl,
        credential: Credential,
        modelOverride: String?,
        method: String,
        headers: Map<String, String>,
        body: ByteArray?,
        sink: ResponseSink,
        exchange: Exchange,
    ) {
        val meter = exchange.meter
        val providerId = provider.id
        // Gemini names the model in the URL (and ignores one in the body), so
        // a pinned model goes there.
        val target = modelOverride?.takeIf { providerId == "gemini" }?.let { RoutingResolver.geminiUrl(url, it) } ?: url
        val upstreamUrl = allowedTarget(provider, target, credential)
        val apiKey = apiKey(credential, provider.name)

        val outHeaders = HeaderPolicy.forwardedHeaders(headers)
        ProviderAuth.apply(outHeaders, providerId, credential.authMethod, apiKey)

        // The group is the strongest routing force: a pinned model wins over
        // the app's choice even when no translation or swap is needed.
        var outBody = modelOverride?.let { pinModel(body, it, providerId, url) } ?: body

        // Anthropic setup tokens only accept Claude-Code-shaped requests; the
        // tool-alias map is applied in reverse on the response.
        var toolNameMap: Map<String, String> = emptyMap()
        val engine = translationEngine?.takeIf { it.isSupported }
        if (isSetupToken(providerId, credential) && outBody != null) {
            val shaped = shapeForSetupToken(outBody.toString(Charsets.UTF_8))
            toolNameMap = shaped.toolNameMap
            outBody = shaped.body.toByteArray(Charsets.UTF_8)
        }
        outBody = injectStreamUsageOptions(providerId, outBody)

        val request = buildRequest(upstreamUrl, method, outHeaders, outBody)
        exchange.execute(client.newCall(request), upstreamUrl, sink).use { response ->
            sink.onMeta(response.code, statusText(response), responseHeaders(response))
            val rewriter = if (toolNameMap.isNotEmpty() && engine != null && response.isSuccessful) engine else null
            when {
                !ResponseChunks.isText(response.header("content-type")) -> streamBytes(response, meter) { sink.onBytes(it) }
                rewriter == null -> streamText(response, meter) { text -> sink.onChunk(text) }
                isEventStream(response) -> {
                    val handle = rewriter.createClaudeCodeSSERewriter(toolNameMap)
                    var flushed = false
                    try {
                        streamText(response, meter) { text ->
                            val out = rewriter.processClaudeCodeSSE(handle, text)
                            if (out.isNotEmpty()) sink.onChunk(out)
                        }
                        val tail = rewriter.flushClaudeCodeSSE(handle)
                        flushed = true
                        if (tail.isNotEmpty()) sink.onChunk(tail)
                    } finally {
                        if (!flushed) rewriter.releaseClaudeCodeSSE(handle)
                    }
                }
                else -> {
                    val full = readText(response, meter)
                    sink.onChunk(rewriter.rewriteClaudeCodeJSONBody(toolNameMap, full))
                }
            }
            sink.onDone()
        }
    }

    /**
     * Cross-family translation: the group (or auto-routing) sends this app's
     * requests to a provider that speaks a different dialect. The body is
     * translated src→dst, the response dst→src, so the app sees its own
     * dialect. A provider error is translated too when core can parse it
     * (translateErrorResponse), and otherwise passed on as sent.
     */
    private fun forwardTranslated(
        url: HttpUrl,
        translation: RoutingTranslation,
        credential: Credential,
        method: String,
        headers: Map<String, String>,
        body: ByteArray?,
        sink: ResponseSink,
        exchange: Exchange,
    ) {
        val meter = exchange.meter
        val engine = translationEngine
            ?: throw ProxyError("TRANSLATION_FAILED", "Translation engine unavailable")
        val isStreaming = RoutingResolver.isStreamingRequest(translation.srcProviderId, url, body)

        val ctxJson = engine.buildTranslationContext(
            srcProviderId = translation.srcProviderId,
            dstProviderId = translation.dstProviderId,
            srcModel = translation.srcModel,
            dstModel = translation.dstModel,
            isStreaming = isStreaming,
            requestId = UUID.randomUUID().toString(),
        )
        val translatedBody = engine.translateRequest(ctxJson, body?.toString(Charsets.UTF_8) ?: "")
        val upstreamUrl = checkedRewrite(
            translation.dstProviderId,
            engine.rewriteProxyUrl(translation.dstProviderId, translation.dstModel, isStreaming, rewriteBase(translation.dstProviderId, credential)),
            credential,
            method,
            "TRANSLATION_FAILED",
        )

        val dstApiKey = apiKey(credential, Provider.find(translation.dstProviderId)?.name ?: translation.dstProviderId)
        val outHeaders = HeaderPolicy.forwardedHeaders(headers, HeaderPolicy.ROUTED_EXCLUDED)
        ProviderAuth.apply(outHeaders, translation.dstProviderId, credential.authMethod, dstApiKey)

        // The translated body is Anthropic-shaped when the destination is
        // Anthropic, so setup tokens get the same Claude Code shaping as the
        // direct path (the extension does this too). Responses then undo the
        // tool aliases first and translate back to the app's dialect second.
        var outText = translatedBody
        var toolNameMap: Map<String, String> = emptyMap()
        if (isSetupToken(translation.dstProviderId, credential)) {
            val shaped = shapeForSetupToken(translatedBody)
            outText = shaped.body
            toolNameMap = shaped.toolNameMap
        }
        val outBody = injectStreamUsageOptions(translation.dstProviderId, outText.toByteArray(Charsets.UTF_8))
        val unalias = toolNameMap.takeIf { it.isNotEmpty() && engine.isSupported }

        val request = buildRequest(upstreamUrl, method, outHeaders, outBody, defaultContentType = "application/json")
        exchange.execute(client.newCall(request), upstreamUrl, sink).use { response ->
            sink.onMeta(response.code, statusText(response), responseHeaders(response))
            when {
                !response.isSuccessful -> {
                    // Only a body within MAX_TRANSLATED_ERROR_CHARS is held
                    // for translation; a longer one goes out as it arrives.
                    val errorBody = TranslatedErrorBody(MAX_TRANSLATED_ERROR_CHARS)
                    streamText(response, meter) { text ->
                        val now = errorBody.append(text)
                        if (now.isNotEmpty()) sink.onChunk(now)
                    }
                    val rest = errorBody.finish { engine.translateErrorResponse(ctxJson, it, response.code) }
                    if (rest.isNotEmpty()) sink.onChunk(rest)
                }
                isStreaming -> {
                    val handle = engine.createStreamTranslator(ctxJson)
                    val aliasHandle = unalias?.let { engine.createClaudeCodeSSERewriter(it) }
                    var flushed = false
                    var aliasFlushed = aliasHandle == null
                    try {
                        streamText(response, meter) { text ->
                            val restored = if (aliasHandle != null) engine.processClaudeCodeSSE(aliasHandle, text) else text
                            if (restored.isNotEmpty()) {
                                val out = engine.processStreamChunk(handle, restored)
                                if (out.isNotEmpty()) sink.onChunk(out)
                            }
                        }
                        if (aliasHandle != null) {
                            val aliasTail = engine.flushClaudeCodeSSE(aliasHandle)
                            aliasFlushed = true
                            if (aliasTail.isNotEmpty()) {
                                val out = engine.processStreamChunk(handle, aliasTail)
                                if (out.isNotEmpty()) sink.onChunk(out)
                            }
                        }
                        val tail = engine.flushStreamTranslator(handle)
                        flushed = true
                        if (tail.isNotEmpty()) sink.onChunk(tail)
                    } finally {
                        if (!aliasFlushed && aliasHandle != null) engine.releaseClaudeCodeSSE(aliasHandle)
                        if (!flushed) engine.releaseStreamTranslator(handle)
                    }
                }
                else -> {
                    val full = readText(response, meter)
                    val restored = if (unalias != null) engine.rewriteClaudeCodeJSONBody(unalias, full) else full
                    sink.onChunk(engine.translateResponse(ctxJson, restored))
                }
            }
            sink.onDone()
        }
    }

    /**
     * Same-family swap (e.g. Groq → OpenAI): identical wire format, so only
     * the URL, the credential and optionally the body's `model` change. The
     * response is forwarded verbatim.
     */
    private fun forwardSwapped(
        originalProviderId: String,
        url: HttpUrl,
        swapToProviderId: String,
        swapDstModel: String?,
        credential: Credential,
        method: String,
        headers: Map<String, String>,
        body: ByteArray?,
        sink: ResponseSink,
        exchange: Exchange,
    ) {
        val meter = exchange.meter
        val engine = translationEngine
            ?: throw ProxyError("SWAP_FAILED", "Translation engine unavailable")
        val isStreaming = RoutingResolver.isStreamingRequest(originalProviderId, url, body)
        // rewriteProxyUrl needs a non-empty model even though most
        // openai-family providers read it from the body.
        val modelForUrl = swapDstModel ?: RoutingResolver.parseModel(body) ?: ""
        val upstreamUrl = checkedRewrite(
            swapToProviderId,
            engine.rewriteProxyUrl(swapToProviderId, modelForUrl, isStreaming, rewriteBase(swapToProviderId, credential)),
            credential,
            method,
            "SWAP_FAILED",
        )

        val dstApiKey = apiKey(credential, Provider.find(swapToProviderId)?.name ?: swapToProviderId)
        val outHeaders = HeaderPolicy.forwardedHeaders(headers, HeaderPolicy.ROUTED_EXCLUDED)
        ProviderAuth.apply(outHeaders, swapToProviderId, credential.authMethod, dstApiKey)
        val swappedBody = if (!swapDstModel.isNullOrEmpty()) pinModel(body, swapDstModel, swapToProviderId, url) else body
        val outBody = injectStreamUsageOptions(swapToProviderId, swappedBody)

        val request = buildRequest(upstreamUrl, method, outHeaders, outBody)
        exchange.execute(client.newCall(request), upstreamUrl, sink).use { response ->
            sink.onMeta(response.code, statusText(response), responseHeaders(response))
            if (ResponseChunks.isText(response.header("content-type"))) {
                streamText(response, meter) { text -> sink.onChunk(text) }
            } else {
                streamBytes(response, meter) { sink.onBytes(it) }
            }
            sink.onDone()
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────────────

    private fun buildRequest(
        url: String,
        method: String,
        headers: Map<String, String>,
        body: ByteArray?,
        defaultContentType: String? = null,
    ): Request {
        val upper = method.uppercase()
        val requestBody = if (body != null && upper in METHODS_WITH_BODY) {
            val contentType = headers.entries.firstOrNull { it.key.equals("content-type", ignoreCase = true) }?.value
                ?: defaultContentType ?: "application/json"
            body.toRequestBody(contentType.toMediaTypeOrNull())
        } else null
        return Request.Builder()
            .url(url)
            .method(upper, requestBody)
            .headers(headers.toHeaders())
            .build()
    }

    private fun isSetupToken(providerId: String, credential: Credential): Boolean =
        providerId == "anthropic" && credential.authMethod == AuthMethod.OAUTH

    /** Claude Code shaping for setup tokens, via the bundled core when the sandbox is available. */
    private fun shapeForSetupToken(body: String): ClaudeCodeShaping.Shaped {
        val engine = translationEngine?.takeIf { it.isSupported }
        val prepare: ((String) -> ClaudeCodeShaping.Shaped)? = engine?.let { e ->
            { text -> e.prepareClaudeCodeBody(text).let { ClaudeCodeShaping.Shaped(it.body, it.toolNameMap) } }
        }
        return ClaudeCodeShaping.shape(body, prepare)
    }

    private fun responseHeaders(response: Response): Map<String, String> {
        val out = mutableMapOf<String, String>()
        for ((name, values) in response.headers.toMultimap()) {
            val lower = name.lowercase()
            if (lower in SENSITIVE_RESPONSE_HEADERS || lower in HOP_BY_HOP_RESPONSE_HEADERS) continue
            out[lower] = values.joinToString(", ")
        }
        return out
    }

    private fun statusText(response: Response): String =
        response.message.ifEmpty { if (response.isSuccessful) "OK" else "Error" }

    private fun isEventStream(response: Response): Boolean =
        response.header("content-type")?.lowercase()?.contains("text/event-stream") == true

    /**
     * Read the body incrementally as UTF-8 text, never splitting a multi-byte
     * character. [meter] sees all text before [onText] does, so usage still
     * counts if [onText] throws (the app went away).
     */
    private fun streamText(response: Response, meter: UsageMeter, onText: (String) -> Unit) {
        val source = response.body?.source() ?: return
        val decoder = Utf8StreamDecoder()
        val buffer = ByteArray(8192)
        while (true) {
            val read = source.read(buffer)
            if (read == -1) break
            if (read > 0) {
                val text = decoder.decode(buffer, read)
                if (text.isNotEmpty()) {
                    meter.onText(text)
                    onText(text)
                }
            }
        }
        val tail = decoder.finish()
        if (tail.isNotEmpty()) meter.onText(tail)
        meter.complete = true
        if (tail.isNotEmpty()) onText(tail)
    }

    /**
     * Read a binary body as it arrives, unchanged. Usage isn't parsed from
     * it (only JSON and SSE carry usage); the meter only learns it ended.
     */
    private fun streamBytes(response: Response, meter: UsageMeter, onBytes: (ByteArray) -> Unit) {
        val source = response.body?.source() ?: return
        val buffer = ByteArray(8192)
        while (true) {
            val read = source.read(buffer)
            if (read == -1) break
            if (read > 0) onBytes(buffer.copyOf(read))
        }
        meter.complete = true
    }

    private fun readText(response: Response, meter: UsageMeter): String {
        val sb = StringBuilder()
        streamText(response, meter) { sb.append(it) }
        return sb.toString()
    }

    /**
     * [body] with the group's pinned [model] (a model of the app's own
     * family, sent to [providerId]), fitted by core to that model's request
     * rules for a chat request to [url]. Throws a [ProxyError] for a request
     * the model can't serve. Only renames the model when the engine can't
     * help (no JavaScriptSandbox, an older bundle, a body too large for it).
     */
    private fun pinModel(body: ByteArray?, model: String, providerId: String, url: HttpUrl): ByteArray? {
        if (body == null) return null
        val engine = translationEngine?.takeIf { it.isSupported }
        val text = body.toString(Charsets.UTF_8)
        return when (val rewrite = engine?.rewriteRequestModel(providerId, url.toString(), text, model)) {
            // A body core left as it was (not JSON, already the model) keeps its bytes.
            is ModelRewrite.Body -> if (rewrite.body == text) body else rewrite.body.toByteArray(Charsets.UTF_8)
            is ModelRewrite.Refused -> throw ProxyError(rewrite.code, rewrite.message, 400)
            // Embeddings, audio and the like keep the app's model, as in core.
            // A Gemini URL that names the model gets the pin instead (a body
            // `model` would be ignored); Gemini's OpenAI-compatible endpoint
            // takes it from the body like everyone else.
            null -> when {
                !EndpointPolicy.isModelPinnable(url) -> body
                providerId == "gemini" && RoutingResolver.geminiUrl(url, model) != null -> body
                else -> rewriteModel(body, model)
            }
        }
    }

    /** Rewrite the top-level `model` of a JSON body; unparseable bodies pass through untouched. */
    private fun rewriteModel(body: ByteArray?, newModel: String): ByteArray? {
        if (body == null) return null
        return try {
            val parsed = JSONObject(String(body, Charsets.UTF_8))
            parsed.put("model", newModel)
            parsed.toString().toByteArray(Charsets.UTF_8)
        } catch (_: Exception) {
            body
        }
    }

    private fun injectStreamUsageOptions(providerId: String, body: ByteArray?): ByteArray? {
        if (body == null || providerId !in STREAM_USAGE_PROVIDERS) return body
        return try {
            val parsed = JSONObject(String(body, Charsets.UTF_8))
            if (parsed.optBoolean("stream", false)) {
                val streamOptions = parsed.optJSONObject("stream_options") ?: JSONObject()
                if (!streamOptions.optBoolean("include_usage", false)) {
                    streamOptions.put("include_usage", true)
                    parsed.put("stream_options", streamOptions)
                    parsed.toString().toByteArray(Charsets.UTF_8)
                } else body
            } else body
        } catch (_: Exception) { body }
    }

    /**
     * Actionable message for the PROVIDER_UNAVAILABLE error:
     *   1. The group's pinned key is gone (or isn't one of its provider's).
     *   2. The app's group routes to a provider with no key → name it; with
     *      a key but no model to translate with → ask for a model.
     *   3. The wallet has keys, just not for this provider → list them.
     *   4. The wallet is empty → ask for any key.
     */
    private fun noCredentialMessage(providerId: String, credentials: List<Credential>, group: Group?): String {
        val pin = group?.credentialId
        if (group != null && pin != null && credentials.none { it.id == pin && it.providerId == group.providerId }) {
            return "The key this app's group \"${group.name}\" is pinned to is no longer in your wallet. Edit the group and pick another key."
        }
        // An empty providerId is the default sentinel group: no routing.
        val groupBinding = group?.providerId?.takeIf { it.isNotEmpty() }
        if (groupBinding != null && groupBinding != providerId) {
            val engine = translationEngine
            val modelMissing = group?.model.isNullOrEmpty() && engine?.autoRouteModelFor(groupBinding) == null
            if (modelMissing && engine != null && credentials.any { it.providerId == groupBinding } &&
                engine.shouldTranslate(providerId, groupBinding)
            ) {
                return "This app's group routes it to $groupBinding, which needs a model to translate $providerId requests. Set a model on the group."
            }
            return "No $groupBinding API key found. Add a $groupBinding key to your wallet, or assign this app to a provider you already have a key for."
        }
        val held = credentials.map { it.providerId }.distinct().sorted()
        if (held.isNotEmpty()) {
            return "No $providerId API key found. Keys: ${held.joinToString(", ")}. Add a $providerId key, or assign this app to one of those providers."
        }
        return "No API keys in your wallet. Add a key for any provider to get started."
    }

    companion object {
        /** Origin used for requests that don't come from an identified app. */
        const val DEFAULT_ORIGIN = "bridge"

        // Providers that need stream_options injection for token usage in
        // streaming responses (canonical azure_openai id, underscore).
        private val STREAM_USAGE_PROVIDERS = setOf("openai", "azure_openai", "together", "deepseek")
        private val METHODS_WITH_BODY = setOf("POST", "PUT", "PATCH")

        /** Logged for requests the app cancelled before any response (nginx's "client closed request"). */
        private const val CANCELLED_STATUS = 499

        /**
         * How long the upstream may go without sending data. Non-streaming
         * replies send their headers only once generation ends, which for
         * long outputs and reasoning models often takes minutes; the provider
         * SDKs allow 10.
         */
        const val UPSTREAM_READ_TIMEOUT_SECONDS = 600L

        /**
         * Largest error body handed to core for translation into the app's
         * dialect; a bigger one is passed on as sent, as it arrives.
         */
        internal const val MAX_TRANSLATED_ERROR_CHARS = 1_000_000

        /**
         * The upstream client. Redirects are never followed: OkHttp would
         * carry x-api-key / x-goog-api-key / api-key to whatever host the
         * Location names. A 3xx goes back to the app as is.
         */
        fun newUpstreamClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(UPSTREAM_READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .build()

        /** HTTP status of a proxy error code, as the extension and iOS send it. */
        fun statusFor(code: String): Int = when (code) {
            "SESSION_EXPIRED" -> 401
            "PROVIDER_UNAVAILABLE", "INVALID_URL", EndpointPolicy.ERROR_CODE -> 403
            "TRANSLATION_NOT_SUPPORTED", "ROUTING_UNSUPPORTED" -> 400
            "QUOTA_EXCEEDED" -> 429
            "PROXY_ERROR", "TRANSLATION_FAILED", "SWAP_FAILED" -> 502
            else -> 500
        }

        /** The app asked for a provider this wallet doesn't know. */
        fun unknownProvider(providerId: String) =
            ProxyError("PROVIDER_UNAVAILABLE", "Unknown provider: $providerId")

        /** A stored key with a character providers reject (added before the format check). */
        fun unusableKey(providerName: String, label: String) = ProxyError(
            "PROVIDER_UNAVAILABLE",
            "The $providerName key \"$label\" contains a character providers don't accept. Remove it and add it again.",
        )

        /** A key of a provider without a fixed host (Azure, Ollama, LM Studio) that has no usable server URL. */
        fun missingBaseUrl(providerName: String, label: String) = ProxyError(
            "PROVIDER_UNAVAILABLE",
            "The $providerName key \"$label\" has no server URL. Tap the key in your wallet to add its endpoint.",
        )

        fun endpointNotAllowed() = ProxyError(EndpointPolicy.ERROR_CODE, EndpointPolicy.ERROR_MESSAGE, EndpointPolicy.ERROR_STATUS)

        val SENSITIVE_RESPONSE_HEADERS = setOf(
            "server", "x-request-id", "x-cloud-trace-context",
            "set-cookie", "set-cookie2", "alt-svc", "via",
        )
        // The body is re-emitted as decoded text chunks, so framing and
        // encoding headers from upstream no longer describe it.
        private val HOP_BY_HOP_RESPONSE_HEADERS = setOf(
            "content-length", "content-encoding", "transfer-encoding", "connection", "keep-alive",
        )
    }
}
