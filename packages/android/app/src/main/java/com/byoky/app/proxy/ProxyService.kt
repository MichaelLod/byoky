package com.byoky.app.proxy

import android.content.Context
import com.byoky.app.data.AuthMethod
import com.byoky.app.data.Credential
import com.byoky.app.data.DEFAULT_GROUP_ID
import com.byoky.app.data.GiftedCredential
import com.byoky.app.data.Provider
import com.byoky.app.data.RoutingTranslation
import com.byoky.app.data.WalletStore
import com.byoky.app.data.isGiftExpired
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import okhttp3.Headers.Companion.toHeaders
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class ProxyService(
    private val wallet: WalletStore,
    private val appContext: Context? = null,
) {
    /**
     * The translation engine. Lazy because constructing it requires an
     * Android Context for JavaScriptSandbox; the existing call sites that
     * only need findAvailablePort() can pass null and never touch it.
     * The proxy paths that DO use it require a context to have been provided.
     */
    private val translationEngine: TranslationEngine? by lazy {
        appContext?.let { TranslationEngine.get(it) }
    }
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private sealed class CredentialSource {
        data class Own(val credential: Credential, val apiKey: String) : CredentialSource()
        data class Gift(val gc: GiftedCredential) : CredentialSource()
    }

    fun findAvailablePort(): Int {
        return try {
            ServerSocket().use { socket ->
                socket.reuseAddress = true
                socket.bind(InetSocketAddress("127.0.0.1", 0))
                socket.localPort
            }
        } catch (_: Exception) {
            0
        }
    }

    fun checkAvailable(): Boolean {
        return wallet.credentials.value.isNotEmpty() || wallet.giftedCredentials.value.isNotEmpty()
    }

    fun proxyRequest(
        providerId: String,
        path: String,
        method: String,
        headers: Map<String, String>,
        body: ByteArray?,
    ): Response {
        val provider = Provider.find(providerId)
            ?: throw IllegalArgumentException("Unknown provider: $providerId")

        val url = "${provider.baseUrl}$path"

        // Cross-family gift: group pins a gift whose provider differs from
        // the app's request, model is set, pair is translatable. Handle
        // before generic credential resolution so the cross-family gift
        // wins over the direct-provider lookup.
        val crossGift = resolveCrossFamilyGift(providerId, body)
        if (crossGift != null) {
            val (gc, translation) = crossGift
            return proxyRequestViaGiftWithTranslation(
                gc = gc,
                translation = translation,
                originalProviderId = providerId,
                method = method,
                headers = headers,
                body = body,
            )
        }

        val source = resolveCredentialSource(providerId)

        if (source is CredentialSource.Gift) {
            return proxyRequestViaGift(source.gc, url, providerId, method, headers, body)
        }

        val own = source as CredentialSource.Own

        // Routing resolution. Mobile's local TCP proxy currently lacks a
        // per-app origin tag (a single TCP listener serves every caller),
        // so we resolve against the "bridge" origin → default group. The
        // relay path (RelayPairService) carries the real paired origin and
        // uses it for per-app routing; this branch will gain the same once
        // the local proxy adds a pairing handshake. Three outcomes mirror
        // the relay flow:
        //   1. Cross-family translation (group binds a different family)
        //   2. Same-family swap (group binds a different provider in the
        //      same family — different credential, identical wire format)
        //   3. Pass-through (no group, no model, or no usable rule)
        val routing = resolveRouting(providerId, body)
        if (routing != null && routing.translation != null) {
            return proxyRequestWithTranslation(
                originalProviderId = providerId,
                translation = routing.translation,
                routedCredential = routing.credential,
                method = method,
                headers = headers,
                body = body,
            )
        }
        if (routing != null && routing.swapToProviderId != null) {
            return proxyRequestWithSwap(
                originalProviderId = providerId,
                swapToProviderId = routing.swapToProviderId,
                swapDstModel = routing.swapDstModel,
                routedCredential = routing.credential,
                method = method,
                headers = headers,
                body = body,
            )
        }

        val filteredHeaders = headers.filterKeys {
            it.lowercase() !in setOf("host", "authorization", "x-api-key")
        }.toMutableMap()

        applyAuth(filteredHeaders, providerId, own.credential.authMethod, own.apiKey)

        // Group-pinned model wins over the SDK's choice even on the direct
        // path (no provider swap or translation needed, just a body rewrite).
        val overriddenBody = routing?.modelOverride?.let { override ->
            rewriteModelInJsonBody(body?.toString(Charsets.UTF_8), override)?.toByteArray(Charsets.UTF_8)
        } ?: body
        val injectedBody = injectStreamUsageOptions(providerId, overriddenBody)
        val finalBody = if (providerId == "anthropic" && own.credential.authMethod == AuthMethod.OAUTH && injectedBody != null) {
            injectClaudeCodeSystemPrompt(injectedBody)
        } else {
            injectedBody
        }

        val requestBody = when {
            finalBody != null && method.uppercase() in setOf("POST", "PUT", "PATCH") -> {
                val contentType = filteredHeaders["content-type"] ?: "application/json"
                finalBody.toRequestBody(contentType.toMediaTypeOrNull())
            }
            else -> null
        }

        val request = Request.Builder()
            .url(url)
            .method(method.uppercase(), requestBody)
            .headers(filteredHeaders.toHeaders())
            .build()

        return client.newCall(request).execute()
    }

    fun proxyStreamingRequest(
        providerId: String,
        path: String,
        method: String,
        headers: Map<String, String>,
        body: ByteArray?,
    ): Flow<ByteArray> = callbackFlow {
        val provider = Provider.find(providerId)
            ?: throw IllegalArgumentException("Unknown provider: $providerId")

        val url = "${provider.baseUrl}$path"

        // Cross-family gift streaming path: translate request, route
        // through gift relay, apply SSE stream translator to chunks.
        val crossGift = resolveCrossFamilyGift(providerId, body)
        if (crossGift != null) {
            val (gc, translation) = crossGift
            streamViaGiftRelayWithTranslation(
                gc = gc,
                translation = translation,
                originalProviderId = providerId,
                method = method,
                headers = headers,
                body = body,
                onChunk = { trySend(it) },
                onClose = { err -> if (err != null) close(err) else close() },
            )
            awaitClose { /* nothing to cancel explicitly; WS self-closes */ }
            return@callbackFlow
        }

        val credSource = resolveCredentialSource(providerId)
        var giftWs: WebSocket? = null

        if (credSource is CredentialSource.Gift) {
            val gc = credSource.gc
            val requestId = UUID.randomUUID().toString()
            val filteredHeaders = headers.filterKeys {
                it.lowercase() !in setOf("host", "authorization", "x-api-key")
            }

            val wsReq = Request.Builder().url(gc.relayUrl).build()
            giftWs = client.newWebSocket(wsReq, object : WebSocketListener() {
                var authenticated = false
                var reqSent = false

                override fun onOpen(ws: WebSocket, resp: Response) {
                    ws.send(JSONObject().apply {
                        put("type", "relay:auth")
                        put("roomId", gc.giftId)
                        put("authToken", gc.authToken)
                        put("role", "recipient")
                    }.toString())
                }

                fun sendReq(ws: WebSocket) {
                    if (reqSent) return
                    reqSent = true
                    ws.send(JSONObject().apply {
                        put("type", "relay:request")
                        put("requestId", requestId)
                        put("providerId", providerId)
                        put("url", url)
                        put("method", method)
                        put("headers", JSONObject(filteredHeaders))
                        body?.let { put("body", String(it, Charsets.UTF_8)) }
                    }.toString())
                }

                override fun onMessage(ws: WebSocket, text: String) {
                    try {
                        val json = JSONObject(text)
                        when (json.optString("type")) {
                            "relay:auth:result" -> {
                                if (json.optBoolean("success")) {
                                    authenticated = true
                                    if (json.optBoolean("peerOnline", false)) sendReq(ws)
                                } else {
                                    close(Exception("Gift auth failed"))
                                }
                            }
                            "relay:peer:status" -> {
                                if (json.optBoolean("online") && authenticated && !reqSent) sendReq(ws)
                            }
                            "relay:response:chunk" -> {
                                if (json.optString("requestId") == requestId) {
                                    trySend(json.optString("chunk", "").toByteArray(Charsets.UTF_8))
                                }
                            }
                            "relay:response:done" -> {
                                if (json.optString("requestId") == requestId) {
                                    Thread { Thread.sleep(2000); ws.close(1000, null) }.start()
                                    close()
                                }
                            }
                            "relay:response:error" -> {
                                if (json.optString("requestId") == requestId) {
                                    val msg = json.optJSONObject("error")?.optString("message") ?: "Gift relay error"
                                    close(Exception(msg))
                                }
                            }
                            "relay:usage" -> {
                                if (json.optString("giftId") == gc.giftId) {
                                    wallet.updateGiftedCredentialUsage(gc.giftId, json.optInt("usedTokens"))
                                }
                            }
                        }
                    } catch (_: Exception) {}
                }

                override fun onFailure(ws: WebSocket, t: Throwable, resp: Response?) {
                    close(Exception("Gift relay failed: ${t.message}"))
                }
            })
        } else {
            val own = credSource as CredentialSource.Own

            // Routing resolution (mirrors the non-streaming path). Three
            // outcomes: cross-family translation, same-family swap, or fall
            // through to pass-through.
            val routing = resolveRouting(providerId, body)
            if (routing != null && routing.translation != null) {
                streamWithTranslation(
                    originalProviderId = providerId,
                    translation = routing.translation,
                    routedCredential = routing.credential,
                    method = method,
                    headers = headers,
                    body = body,
                    onChunk = { trySend(it) },
                    onError = { close(it) },
                    onComplete = { close() },
                )
            } else if (routing != null && routing.swapToProviderId != null) {
                streamWithSwap(
                    originalProviderId = providerId,
                    swapToProviderId = routing.swapToProviderId,
                    swapDstModel = routing.swapDstModel,
                    routedCredential = routing.credential,
                    method = method,
                    headers = headers,
                    body = body,
                    onChunk = { trySend(it) },
                    onError = { close(it) },
                    onComplete = { close() },
                )
            } else {
                val filteredHeaders = headers.filterKeys {
                    it.lowercase() !in setOf("host", "authorization", "x-api-key")
                }.toMutableMap()

                applyAuth(filteredHeaders, providerId, own.credential.authMethod, own.apiKey)

                // Group-pinned model wins over the SDK's choice even on the
                // direct path (same provider, no translation/swap needed).
                val overriddenBody = routing?.modelOverride?.let { override ->
                    rewriteModelInJsonBody(body?.toString(Charsets.UTF_8), override)?.toByteArray(Charsets.UTF_8)
                } ?: body
                val injectedBody = injectStreamUsageOptions(providerId, overriddenBody)
                val finalBody = if (providerId == "anthropic" && own.credential.authMethod == AuthMethod.OAUTH && injectedBody != null) {
                    injectClaudeCodeSystemPrompt(injectedBody)
                } else {
                    injectedBody
                }

                val requestBody = when {
                    finalBody != null && method.uppercase() in setOf("POST", "PUT", "PATCH") -> {
                        val contentType = filteredHeaders["content-type"] ?: "application/json"
                        finalBody.toRequestBody(contentType.toMediaTypeOrNull())
                    }
                    else -> null
                }

                val request = Request.Builder()
                    .url(url)
                    .method(method.uppercase(), requestBody)
                    .headers(filteredHeaders.toHeaders())
                    .build()

                val response = client.newCall(request).execute()
                val responseBody = response.body

                try {
                    if (responseBody != null) {
                        val source = responseBody.source()
                        val buffer = ByteArray(4096)
                        while (!source.exhausted()) {
                            val read = source.read(buffer)
                            if (read > 0) {
                                send(buffer.copyOf(read))
                            }
                        }
                    }
                    close()
                } catch (e: Exception) {
                    close(e)
                } finally {
                    responseBody?.close()
                }
            }
        }

        awaitClose { giftWs?.close(1000, null) }
    }

    /**
     * Cross-family streaming path. Reads upstream SSE in 4 KB chunks, hands
     * each chunk to the JS stream translator, and forwards the translated
     * bytes back to the caller. Logs once at end with translation metadata.
     */
    private fun streamWithTranslation(
        originalProviderId: String,
        translation: RoutingTranslation,
        routedCredential: Credential,
        method: String,
        headers: Map<String, String>,
        body: ByteArray?,
        onChunk: (ByteArray) -> Unit,
        onError: (Throwable) -> Unit,
        onComplete: () -> Unit,
    ) {
        val engine = translationEngine
        if (engine == null) {
            onError(IllegalStateException("TranslationEngine context not provided"))
            return
        }
        val requestId = UUID.randomUUID().toString()

        val ctxJson: String
        val translatedBodyString: String
        try {
            val bodyString = body?.toString(Charsets.UTF_8) ?: ""
            ctxJson = engine.buildTranslationContext(
                srcProviderId = translation.srcProviderId,
                dstProviderId = translation.dstProviderId,
                srcModel = translation.srcModel,
                dstModel = translation.dstModel,
                isStreaming = true,
                requestId = requestId,
            )
            translatedBodyString = engine.translateRequest(ctxJson, bodyString)
        } catch (t: Throwable) {
            onError(t)
            return
        }

        val urlString = engine.rewriteProxyUrl(translation.dstProviderId, translation.dstModel, true)
        if (urlString == null) {
            onError(IllegalStateException("rewriteProxyUrl returned null for ${translation.dstProviderId}"))
            return
        }

        val dstApiKey = wallet.decryptKey(routedCredential)

        val translatedBytes = injectStreamUsageOptions(translation.dstProviderId, translatedBodyString.toByteArray(Charsets.UTF_8))
            ?: translatedBodyString.toByteArray(Charsets.UTF_8)

        val filteredHeaders = headers.filterKeys {
            it.lowercase() !in setOf("host", "authorization", "x-api-key", "anthropic-version", "content-length")
        }.toMutableMap()
        applyAuth(filteredHeaders, translation.dstProviderId, routedCredential.authMethod, dstApiKey)

        val requestBody = translatedBytes.toRequestBody("application/json".toMediaTypeOrNull())
        val request = Request.Builder()
            .url(urlString)
            .method(method.uppercase(), requestBody)
            .headers(filteredHeaders.toHeaders())
            .build()

        // Open the stream translator handle. Always release it via the
        // finally block below to avoid leaking the JS-side entry.
        val streamHandle = try {
            engine.createStreamTranslator(ctxJson)
        } catch (t: Throwable) {
            onError(t)
            return
        }
        var releasedExplicitly = false

        try {
            val response = client.newCall(request).execute()
            val statusCode = response.code
            val responseBody = response.body

            if (statusCode !in 200..299) {
                // Pass error bodies through verbatim (translator can't handle non-source-shaped errors).
                if (responseBody != null) {
                    val source = responseBody.source()
                    val buffer = ByteArray(4096)
                    while (!source.exhausted()) {
                        val read = source.read(buffer)
                        if (read > 0) onChunk(buffer.copyOf(read))
                    }
                }
                wallet.logRequest(
                    appOrigin = "bridge",
                    providerId = originalProviderId,
                    method = method,
                    url = urlString,
                    statusCode = statusCode,
                    requestBody = body,
                    responseBody = null,
                    actualProviderId = translation.dstProviderId,
                    actualModel = translation.dstModel,
                    groupId = DEFAULT_GROUP_ID,
                )
                responseBody?.close()
                onComplete()
                return
            }

            // 2xx path: stream chunks through the translator. We use 4 KB
            // raw byte reads — the JS translator buffers internally and is
            // tolerant of partial events. UTF-8 boundary risk is small at
            // 4 KB but not zero; the JS-side parser handles invalid bytes
            // gracefully (skips and resumes).
            if (responseBody != null) {
                val source = responseBody.source()
                val buffer = ByteArray(4096)
                while (!source.exhausted()) {
                    val read = source.read(buffer)
                    if (read > 0) {
                        val chunkString = String(buffer, 0, read, Charsets.UTF_8)
                        val translated = engine.processStreamChunk(streamHandle, chunkString)
                        if (translated.isNotEmpty()) {
                            onChunk(translated.toByteArray(Charsets.UTF_8))
                        }
                    }
                }
                // Flush any buffered output and release the handle.
                val trailing = engine.flushStreamTranslator(streamHandle)
                releasedExplicitly = true
                if (trailing.isNotEmpty()) {
                    onChunk(trailing.toByteArray(Charsets.UTF_8))
                }
            }
            responseBody?.close()

            wallet.logRequest(
                appOrigin = "bridge",
                providerId = originalProviderId,
                method = method,
                url = urlString,
                statusCode = statusCode,
                requestBody = body,
                responseBody = null,
                actualProviderId = translation.dstProviderId,
                actualModel = translation.dstModel,
                groupId = DEFAULT_GROUP_ID,
            )
            onComplete()
        } catch (t: Throwable) {
            onError(t)
        } finally {
            if (!releasedExplicitly) {
                engine.releaseStreamTranslator(streamHandle)
            }
        }
    }

    /**
     * Resolve cross-family routing. Returns null for pass-through cases (no
     * group / same family / no model / no credential / no engine context).
     * Caller has already resolved the credential source as `.own` — gifts
     * skip routing entirely.
     */
    private fun resolveRouting(requestedProviderId: String, body: ByteArray?): com.byoky.app.data.RoutingDecision? {
        val engine = translationEngine ?: return null
        val group = wallet.groupForOrigin("bridge")
        val srcModel = RoutingResolver.parseModel(body)
        return RoutingResolver.resolve(
            requestedProviderId = requestedProviderId,
            requestedModel = srcModel,
            group = group,
            credentials = wallet.credentials.value,
            engine = engine,
        )
    }

    /**
     * Cross-family translation path for non-streaming requests. Translates
     * the request body src→dst, sends to the destination provider, and
     * translates the response dst→src so the SDK sees its native dialect.
     */
    private fun proxyRequestWithTranslation(
        originalProviderId: String,
        translation: RoutingTranslation,
        routedCredential: Credential,
        method: String,
        headers: Map<String, String>,
        body: ByteArray?,
    ): Response {
        val engine = translationEngine
            ?: throw IllegalStateException("TranslationEngine context not provided")
        val requestId = UUID.randomUUID().toString()

        // Build context + translate request body via the JS bridge.
        val bodyString = body?.toString(Charsets.UTF_8) ?: ""
        val ctxJson = engine.buildTranslationContext(
            srcProviderId = translation.srcProviderId,
            dstProviderId = translation.dstProviderId,
            srcModel = translation.srcModel,
            dstModel = translation.dstModel,
            isStreaming = false,
            requestId = requestId,
        )
        val translatedBodyString = engine.translateRequest(ctxJson, bodyString)

        // Rewrite upstream URL to the destination provider's chat endpoint.
        val urlString = engine.rewriteProxyUrl(translation.dstProviderId, translation.dstModel, false)
            ?: throw IllegalStateException("rewriteProxyUrl returned null for ${translation.dstProviderId}")

        // Decrypt destination credential.
        val dstApiKey = wallet.decryptKey(routedCredential)

        // Build OkHttp request with translated body and destination auth.
        val translatedBytes = injectStreamUsageOptions(translation.dstProviderId, translatedBodyString.toByteArray(Charsets.UTF_8))
        val finalBody = translatedBytes ?: translatedBodyString.toByteArray(Charsets.UTF_8)

        val filteredHeaders = headers.filterKeys {
            it.lowercase() !in setOf("host", "authorization", "x-api-key", "anthropic-version", "content-length")
        }.toMutableMap()
        applyAuth(filteredHeaders, translation.dstProviderId, routedCredential.authMethod, dstApiKey)

        val requestBody = finalBody.toRequestBody("application/json".toMediaTypeOrNull())
        val request = Request.Builder()
            .url(urlString)
            .method(method.uppercase(), requestBody)
            .headers(filteredHeaders.toHeaders())
            .build()

        val upstream = client.newCall(request).execute()
        val statusCode = upstream.code
        val upstreamBody = upstream.body?.string() ?: ""

        // Translate response dst → src so the app sees its dialect. Skip on
        // non-2xx — error bodies are rarely in the source dialect's shape.
        val translatedResponseString = if (statusCode in 200..299) {
            engine.translateResponse(ctxJson, upstreamBody)
        } else {
            upstreamBody
        }

        wallet.logRequest(
            appOrigin = "bridge",
            providerId = originalProviderId,
            method = method,
            url = urlString,
            statusCode = statusCode,
            requestBody = body,
            responseBody = translatedResponseString,
            actualProviderId = translation.dstProviderId,
            actualModel = translation.dstModel,
            groupId = DEFAULT_GROUP_ID,
        )

        // Build a fresh Response with the translated body so the caller sees
        // the source dialect. Preserve status + headers from the upstream.
        return Response.Builder()
            .request(request)
            .protocol(upstream.protocol)
            .code(statusCode)
            .message(upstream.message)
            .headers(upstream.headers)
            .body(translatedResponseString.toResponseBody("application/json".toMediaTypeOrNull()))
            .build()
    }

    /**
     * Same-family swap path for non-streaming requests. Two providers in the
     * same family (e.g. Groq → OpenAI) speak identical wire formats, so we
     * skip the JS translation bridge entirely and just rewrite the URL, swap
     * the credential, and (optionally) override the body's `model` field.
     * Mirrors `RelayPairService.handleRelayRequestWithSwap`.
     */
    private fun proxyRequestWithSwap(
        originalProviderId: String,
        swapToProviderId: String,
        swapDstModel: String?,
        routedCredential: Credential,
        method: String,
        headers: Map<String, String>,
        body: ByteArray?,
    ): Response {
        val engine = translationEngine
            ?: throw IllegalStateException("TranslationEngine context not provided")
        val isStreaming = RoutingResolver.isStreamingRequest(body)
        // Use the group's pinned destination model for URL building when set,
        // otherwise fall back to whatever the SDK sent. Most openai-family
        // providers ignore the model in the URL (it comes from the body),
        // but rewriteProxyUrl needs a non-empty value to build a URL.
        val modelForUrl = swapDstModel ?: RoutingResolver.parseModel(body) ?: ""

        val urlString = engine.rewriteProxyUrl(swapToProviderId, modelForUrl, isStreaming)
            ?: throw IllegalStateException("rewriteProxyUrl returned null for $swapToProviderId")

        // Substitute the body's `model` field with the group's pinned dst
        // model when set. Same-family providers all accept a JSON body with
        // a top-level `model` string, so a surgical edit is safe and minimal.
        val bodyString = body?.toString(Charsets.UTF_8)
        val forwardedString = if (!swapDstModel.isNullOrEmpty()) {
            rewriteModelInJsonBody(bodyString, swapDstModel)
        } else {
            bodyString
        }
        val injectedBytes = injectStreamUsageOptions(swapToProviderId, forwardedString?.toByteArray(Charsets.UTF_8))
            ?: forwardedString?.toByteArray(Charsets.UTF_8)

        val dstApiKey = wallet.decryptKey(routedCredential)

        val filteredHeaders = headers.filterKeys {
            it.lowercase() !in setOf("host", "authorization", "x-api-key", "anthropic-version", "content-length")
        }.toMutableMap()
        applyAuth(filteredHeaders, swapToProviderId, routedCredential.authMethod, dstApiKey)

        val requestBody = if (injectedBytes != null && method.uppercase() in setOf("POST", "PUT", "PATCH")) {
            val contentType = filteredHeaders["content-type"] ?: "application/json"
            injectedBytes.toRequestBody(contentType.toMediaTypeOrNull())
        } else null

        val request = Request.Builder()
            .url(urlString)
            .method(method.uppercase(), requestBody)
            .headers(filteredHeaders.toHeaders())
            .build()

        val upstream = client.newCall(request).execute()
        val statusCode = upstream.code

        // Forward the response verbatim — wire formats are identical on both
        // sides of a same-family swap. Read the body once for logging then
        // re-emit it on the synthesized Response so the caller still sees it.
        val upstreamBytes = upstream.body?.bytes() ?: ByteArray(0)
        wallet.logRequest(
            appOrigin = "bridge",
            providerId = originalProviderId,
            method = method,
            url = urlString,
            statusCode = statusCode,
            requestBody = body,
            responseBody = upstreamBytes.toString(Charsets.UTF_8),
            actualProviderId = swapToProviderId,
            actualModel = swapDstModel,
            groupId = DEFAULT_GROUP_ID,
        )

        return Response.Builder()
            .request(request)
            .protocol(upstream.protocol)
            .code(statusCode)
            .message(upstream.message)
            .headers(upstream.headers)
            .body(upstreamBytes.toResponseBody(upstream.body?.contentType()))
            .build()
    }

    /**
     * Same-family swap path for streaming requests. Mirrors the non-streaming
     * version above but pipes upstream bytes straight through to the caller —
     * no translation, just verbatim forwarding under the destination
     * provider's credential.
     */
    private fun streamWithSwap(
        originalProviderId: String,
        swapToProviderId: String,
        swapDstModel: String?,
        routedCredential: Credential,
        method: String,
        headers: Map<String, String>,
        body: ByteArray?,
        onChunk: (ByteArray) -> Unit,
        onError: (Throwable) -> Unit,
        onComplete: () -> Unit,
    ) {
        val engine = translationEngine
        if (engine == null) {
            onError(IllegalStateException("TranslationEngine context not provided"))
            return
        }
        val modelForUrl = swapDstModel ?: RoutingResolver.parseModel(body) ?: ""
        val urlString = engine.rewriteProxyUrl(swapToProviderId, modelForUrl, true)
        if (urlString == null) {
            onError(IllegalStateException("rewriteProxyUrl returned null for $swapToProviderId"))
            return
        }

        val bodyString = body?.toString(Charsets.UTF_8)
        val forwardedString = if (!swapDstModel.isNullOrEmpty()) {
            rewriteModelInJsonBody(bodyString, swapDstModel)
        } else {
            bodyString
        }
        val injectedBytes = injectStreamUsageOptions(swapToProviderId, forwardedString?.toByteArray(Charsets.UTF_8))
            ?: forwardedString?.toByteArray(Charsets.UTF_8)

        val dstApiKey = wallet.decryptKey(routedCredential)

        val filteredHeaders = headers.filterKeys {
            it.lowercase() !in setOf("host", "authorization", "x-api-key", "anthropic-version", "content-length")
        }.toMutableMap()
        applyAuth(filteredHeaders, swapToProviderId, routedCredential.authMethod, dstApiKey)

        val requestBody = if (injectedBytes != null && method.uppercase() in setOf("POST", "PUT", "PATCH")) {
            val contentType = filteredHeaders["content-type"] ?: "application/json"
            injectedBytes.toRequestBody(contentType.toMediaTypeOrNull())
        } else null

        val request = Request.Builder()
            .url(urlString)
            .method(method.uppercase(), requestBody)
            .headers(filteredHeaders.toHeaders())
            .build()

        try {
            val response = client.newCall(request).execute()
            val statusCode = response.code
            val responseBody = response.body
            try {
                if (responseBody != null) {
                    val source = responseBody.source()
                    val buffer = ByteArray(4096)
                    while (!source.exhausted()) {
                        val read = source.read(buffer)
                        if (read > 0) onChunk(buffer.copyOf(read))
                    }
                }
                wallet.logRequest(
                    appOrigin = "bridge",
                    providerId = originalProviderId,
                    method = method,
                    url = urlString,
                    statusCode = statusCode,
                    requestBody = body,
                    responseBody = null,
                    actualProviderId = swapToProviderId,
                    actualModel = swapDstModel,
                    groupId = DEFAULT_GROUP_ID,
                )
                onComplete()
            } finally {
                responseBody?.close()
            }
        } catch (t: Throwable) {
            onError(t)
        }
    }

    /**
     * Surgically rewrite the top-level `model` field of a JSON request body
     * to [newModel]. Returns the original body unchanged if parsing fails —
     * we'd rather pass through and let the destination return a real error
     * than silently corrupt the request. Used by the same-family swap path
     * when the group pins a destination model.
     */
    private fun rewriteModelInJsonBody(body: String?, newModel: String): String? {
        if (body == null) return null
        return try {
            val parsed = JSONObject(body)
            parsed.put("model", newModel)
            parsed.toString()
        } catch (_: Exception) {
            body
        }
    }

    /**
     * Detect a cross-family gift route. Returns (gift, translation) when
     * the active group pins a gift whose provider differs from the app's
     * request AND a model is set AND the pair is translatable.
     */
    private fun resolveCrossFamilyGift(
        providerId: String,
        body: ByteArray?,
    ): Pair<GiftedCredential, com.byoky.app.data.RoutingTranslation>? {
        val engine = translationEngine ?: return null
        val group = wallet.groupForOrigin("bridge") ?: return null
        if (group.providerId == providerId) return null
        val gid = group.giftId ?: return null
        val model = group.model
        if (model.isNullOrEmpty()) return null
        val srcModel = com.byoky.app.proxy.RoutingResolver.parseModel(body) ?: return null
        if (!engine.shouldTranslate(providerId, group.providerId)) return null
        val gc = wallet.giftedCredentials.value.firstOrNull {
            it.giftId == gid && !isGiftExpired(it.expiresAt) && it.usedTokens < it.maxTokens
        } ?: return null
        return gc to com.byoky.app.data.RoutingTranslation(
            srcProviderId = providerId,
            dstProviderId = group.providerId,
            srcModel = srcModel,
            dstModel = model,
        )
    }

    private fun resolveCredentialSource(providerId: String): CredentialSource {
        val prefs = wallet.giftPreferences.value
        val giftedCreds = wallet.giftedCredentials.value
        val ownCred = wallet.credentials.value.firstOrNull { it.providerId == providerId }
        val group = wallet.groupForOrigin("bridge")

        // A group pinned to a specific gift for this provider wins over every
        // other source — owned creds, preferences, unpinned gifts. The gift's
        // own relay carries the request. Falls through if the pinned gift is
        // expired, exhausted, or gone.
        if (group != null && group.providerId == providerId && group.giftId != null) {
            val pinnedGift = giftedCreds.firstOrNull {
                it.giftId == group.giftId
                        && !isGiftExpired(it.expiresAt) && it.usedTokens < it.maxTokens
            }
            if (pinnedGift != null) return CredentialSource.Gift(pinnedGift)
        }

        val preferredGiftId = prefs[providerId]
        if (preferredGiftId != null) {
            val gc = giftedCreds.firstOrNull {
                it.giftId == preferredGiftId && it.providerId == providerId
                        && !isGiftExpired(it.expiresAt) && it.usedTokens < it.maxTokens
            }
            if (gc != null) return CredentialSource.Gift(gc)
        }

        if (ownCred != null) {
            val apiKey = wallet.decryptKey(ownCred)
            return CredentialSource.Own(ownCred, apiKey)
        }

        val gc = giftedCreds.firstOrNull {
            it.providerId == providerId && !isGiftExpired(it.expiresAt) && it.usedTokens < it.maxTokens
        }
        if (gc != null) return CredentialSource.Gift(gc)

        throw IllegalStateException("No credential for provider: $providerId")
    }

    private fun proxyRequestViaGift(
        gc: GiftedCredential,
        url: String,
        providerId: String,
        method: String,
        headers: Map<String, String>,
        body: ByteArray?,
    ): Response {
        val requestId = UUID.randomUUID().toString()
        val latch = CountDownLatch(1)
        var error: Exception? = null
        var responseCode = 0
        var responseMessage = ""
        val respHeaders = mutableMapOf<String, String>()
        val responseBody = StringBuilder()
        val filteredHeaders = headers.filterKeys {
            it.lowercase() !in setOf("host", "authorization", "x-api-key")
        }

        val wsReq = Request.Builder().url(gc.relayUrl).build()
        val ws = client.newWebSocket(wsReq, object : WebSocketListener() {
            var authenticated = false
            var reqSent = false

            override fun onOpen(ws: WebSocket, resp: Response) {
                ws.send(JSONObject().apply {
                    put("type", "relay:auth")
                    put("roomId", gc.giftId)
                    put("authToken", gc.authToken)
                    put("role", "recipient")
                }.toString())
            }

            fun sendReq(ws: WebSocket) {
                if (reqSent) return
                reqSent = true
                ws.send(JSONObject().apply {
                    put("type", "relay:request")
                    put("requestId", requestId)
                    put("providerId", providerId)
                    put("url", url)
                    put("method", method)
                    put("headers", JSONObject(filteredHeaders))
                    body?.let { put("body", String(it, Charsets.UTF_8)) }
                }.toString())
            }

            override fun onMessage(ws: WebSocket, text: String) {
                try {
                    val json = JSONObject(text)
                    when (json.optString("type")) {
                        "relay:auth:result" -> {
                            if (json.optBoolean("success")) {
                                authenticated = true
                                if (json.optBoolean("peerOnline", false)) {
                                    sendReq(ws)
                                }
                            } else {
                                error = Exception("Gift auth failed: ${json.optString("error")}")
                                latch.countDown()
                            }
                        }
                        "relay:peer:status" -> {
                            if (json.optBoolean("online") && authenticated && !reqSent) {
                                sendReq(ws)
                            }
                        }
                        "relay:response:meta" -> {
                            if (json.optString("requestId") == requestId) {
                                responseCode = json.optInt("status")
                                responseMessage = json.optString("statusText", "")
                                val hdrs = json.optJSONObject("headers")
                                hdrs?.keys()?.forEach { k -> respHeaders[k] = hdrs.getString(k) }
                            }
                        }
                        "relay:response:chunk" -> {
                            if (json.optString("requestId") == requestId) {
                                responseBody.append(json.optString("chunk", ""))
                            }
                        }
                        "relay:response:done" -> {
                            if (json.optString("requestId") == requestId) {
                                latch.countDown()
                                Thread { Thread.sleep(2000); ws.close(1000, null) }.start()
                            }
                        }
                        "relay:response:error" -> {
                            if (json.optString("requestId") == requestId) {
                                val errObj = json.optJSONObject("error")
                                error = Exception(errObj?.optString("message") ?: "Gift relay error")
                                latch.countDown()
                            }
                        }
                        "relay:usage" -> {
                            if (json.optString("giftId") == gc.giftId) {
                                wallet.updateGiftedCredentialUsage(gc.giftId, json.optInt("usedTokens"))
                            }
                        }
                    }
                } catch (_: Exception) {}
            }

            override fun onFailure(ws: WebSocket, t: Throwable, resp: Response?) {
                error = Exception("Gift relay failed: ${t.message}")
                latch.countDown()
            }
        })

        if (!latch.await(150, TimeUnit.SECONDS)) {
            ws.close(1000, null)
            throw Exception("Gift relay request timed out")
        }

        error?.let { throw it }

        return Response.Builder()
            .code(responseCode)
            .message(responseMessage)
            .request(Request.Builder().url(url).build())
            .protocol(okhttp3.Protocol.HTTP_1_1)
            .body(responseBody.toString().toResponseBody("application/json".toMediaTypeOrNull()))
            .headers(okhttp3.Headers.Builder().apply {
                respHeaders.forEach { (k, v) -> add(k, v) }
            }.build())
            .build()
    }

    /**
     * Cross-family translation via the gift relay for the local TCP proxy
     * non-streaming path. Translates request body src → dst, routes through
     * the gift relay (sender holds the dst-provider API key), buffers the
     * response, then translates dst → src. Non-2xx responses pass through
     * verbatim.
     */
    private fun proxyRequestViaGiftWithTranslation(
        gc: GiftedCredential,
        translation: com.byoky.app.data.RoutingTranslation,
        originalProviderId: String,
        method: String,
        headers: Map<String, String>,
        body: ByteArray?,
    ): Response {
        val engine = translationEngine
            ?: throw IllegalStateException("TranslationEngine context not provided")
        val bodyString = body?.let { String(it, Charsets.UTF_8) } ?: ""
        val isStreaming = com.byoky.app.proxy.RoutingResolver.isStreamingRequest(body)
        val requestId = UUID.randomUUID().toString()

        val ctxJson = engine.buildTranslationContext(
            srcProviderId = translation.srcProviderId,
            dstProviderId = translation.dstProviderId,
            srcModel = translation.srcModel,
            dstModel = translation.dstModel,
            isStreaming = isStreaming,
            requestId = requestId,
        )
        val translatedBody = engine.translateRequest(ctxJson, bodyString)
        val urlString = engine.rewriteProxyUrl(translation.dstProviderId, translation.dstModel, isStreaming)
            ?: throw IllegalStateException("rewriteProxyUrl returned null")

        val filteredHeaders = headers.filterKeys {
            it.lowercase() !in setOf("host", "authorization", "x-api-key", "anthropic-version", "content-length")
        }

        val latch = CountDownLatch(1)
        var responseCode = 0
        var responseMessage = ""
        val respHeaders = mutableMapOf<String, String>()
        val rawBody = StringBuilder()
        var isUpstreamError = false
        var streamHandle: Int? = null
        var handleReleased = false
        var error: Throwable? = null

        fun releaseHandle() {
            val h = streamHandle
            if (h != null && !handleReleased) {
                try { engine.releaseStreamTranslator(h) } catch (_: Throwable) {}
                handleReleased = true
            }
        }

        val wsReq = Request.Builder().url(gc.relayUrl).build()
        val ws = client.newWebSocket(wsReq, object : WebSocketListener() {
            var authenticated = false
            var reqSent = false

            override fun onOpen(ws: WebSocket, resp: Response) {
                ws.send(JSONObject().apply {
                    put("type", "relay:auth")
                    put("roomId", gc.giftId)
                    put("authToken", gc.authToken)
                    put("role", "recipient")
                }.toString())
            }

            fun sendReq(ws: WebSocket) {
                if (reqSent) return
                reqSent = true
                ws.send(JSONObject().apply {
                    put("type", "relay:request")
                    put("requestId", requestId)
                    put("providerId", translation.dstProviderId)
                    put("url", urlString)
                    put("method", method)
                    put("headers", JSONObject(filteredHeaders))
                    put("body", translatedBody)
                }.toString())
            }

            override fun onMessage(ws: WebSocket, text: String) {
                try {
                    val json = JSONObject(text)
                    when (json.optString("type")) {
                        "relay:auth:result" -> {
                            if (json.optBoolean("success")) {
                                authenticated = true
                                if (json.optBoolean("peerOnline", false)) sendReq(ws)
                            } else {
                                error = Exception("Gift auth failed")
                                latch.countDown()
                            }
                        }
                        "relay:peer:status" -> {
                            if (json.optBoolean("online") && authenticated && !reqSent) sendReq(ws)
                        }
                        "relay:response:meta" -> {
                            if (json.optString("requestId") == requestId) {
                                responseCode = json.optInt("status")
                                responseMessage = json.optString("statusText", "")
                                isUpstreamError = responseCode !in 200..299
                                val hdrs = json.optJSONObject("headers")
                                hdrs?.keys()?.forEach { k -> respHeaders[k] = hdrs.getString(k) }
                                if (!isUpstreamError && isStreaming) {
                                    try {
                                        streamHandle = engine.createStreamTranslator(ctxJson)
                                    } catch (t: Throwable) {
                                        error = t
                                        latch.countDown()
                                    }
                                }
                            }
                        }
                        "relay:response:chunk" -> {
                            if (json.optString("requestId") == requestId) {
                                val chunk = json.optString("chunk", "")
                                val handle = streamHandle
                                if (isUpstreamError) {
                                    rawBody.append(chunk)
                                } else if (handle != null) {
                                    try {
                                        val translated = engine.processStreamChunk(handle, chunk)
                                        if (translated.isNotEmpty()) rawBody.append(translated)
                                    } catch (t: Throwable) {
                                        error = t
                                        releaseHandle()
                                        latch.countDown()
                                    }
                                } else {
                                    // Non-streaming: accumulate the dst body.
                                    rawBody.append(chunk)
                                }
                            }
                        }
                        "relay:response:done" -> {
                            if (json.optString("requestId") == requestId) {
                                val handle = streamHandle
                                try {
                                    if (handle != null) {
                                        val trailing = engine.flushStreamTranslator(handle)
                                        if (trailing.isNotEmpty()) rawBody.append(trailing)
                                    } else if (!isUpstreamError && !isStreaming) {
                                        // Swap dst body for translated src body.
                                        val translated = engine.translateResponse(ctxJson, rawBody.toString())
                                        rawBody.clear()
                                        rawBody.append(translated)
                                    }
                                } catch (t: Throwable) {
                                    error = t
                                } finally {
                                    releaseHandle()
                                }
                                latch.countDown()
                                Thread { Thread.sleep(2000); ws.close(1000, null) }.start()
                            }
                        }
                        "relay:response:error" -> {
                            if (json.optString("requestId") == requestId) {
                                val errObj = json.optJSONObject("error")
                                error = Exception(errObj?.optString("message") ?: "Gift relay error")
                                releaseHandle()
                                latch.countDown()
                            }
                        }
                        "relay:usage" -> {
                            if (json.optString("giftId") == gc.giftId) {
                                wallet.updateGiftedCredentialUsage(gc.giftId, json.optInt("usedTokens"))
                            }
                        }
                    }
                } catch (_: Exception) {}
            }

            override fun onFailure(ws: WebSocket, t: Throwable, resp: Response?) {
                error = Exception("Gift relay failed: ${t.message}")
                releaseHandle()
                latch.countDown()
            }
        })

        if (!latch.await(150, TimeUnit.SECONDS)) {
            ws.close(1000, null)
            releaseHandle()
            throw Exception("Gift relay request timed out")
        }

        error?.let { throw it }

        return Response.Builder()
            .code(if (responseCode == 0) 502 else responseCode)
            .message(responseMessage)
            .request(Request.Builder().url(urlString).build())
            .protocol(okhttp3.Protocol.HTTP_1_1)
            .body(rawBody.toString().toResponseBody("application/json".toMediaTypeOrNull()))
            .headers(okhttp3.Headers.Builder().apply {
                respHeaders.forEach { (k, v) -> add(k, v) }
            }.build())
            .build()
    }

    /**
     * Streaming variant — feeds raw gift-relay chunks through a stream
     * translator and calls onChunk for each translated byte slice. Closes
     * the Flow via onClose when the relay emits done or fails.
     */
    private fun streamViaGiftRelayWithTranslation(
        gc: GiftedCredential,
        translation: com.byoky.app.data.RoutingTranslation,
        originalProviderId: String,
        method: String,
        headers: Map<String, String>,
        body: ByteArray?,
        onChunk: (ByteArray) -> Unit,
        onClose: (Throwable?) -> Unit,
    ) {
        val engine = translationEngine ?: run {
            onClose(IllegalStateException("TranslationEngine context not provided"))
            return
        }
        val bodyString = body?.let { String(it, Charsets.UTF_8) } ?: ""
        val isStreaming = com.byoky.app.proxy.RoutingResolver.isStreamingRequest(body)
        val requestId = UUID.randomUUID().toString()

        val ctxJson: String
        val translatedBody: String
        val urlString: String
        try {
            ctxJson = engine.buildTranslationContext(
                srcProviderId = translation.srcProviderId,
                dstProviderId = translation.dstProviderId,
                srcModel = translation.srcModel,
                dstModel = translation.dstModel,
                isStreaming = isStreaming,
                requestId = requestId,
            )
            translatedBody = engine.translateRequest(ctxJson, bodyString)
            urlString = engine.rewriteProxyUrl(translation.dstProviderId, translation.dstModel, isStreaming)
                ?: run {
                    onClose(IllegalStateException("rewriteProxyUrl returned null"))
                    return
                }
        } catch (t: Throwable) {
            onClose(t)
            return
        }

        val filteredHeaders = headers.filterKeys {
            it.lowercase() !in setOf("host", "authorization", "x-api-key", "anthropic-version", "content-length")
        }

        val wsReq = Request.Builder().url(gc.relayUrl).build()
        client.newWebSocket(wsReq, object : WebSocketListener() {
            var authenticated = false
            var reqSent = false
            var isUpstreamError = false
            var streamHandle: Int? = null
            var handleReleased = false
            val accumulated = StringBuilder()

            fun releaseHandle() {
                val h = streamHandle
                if (h != null && !handleReleased) {
                    try { engine.releaseStreamTranslator(h) } catch (_: Throwable) {}
                    handleReleased = true
                }
            }

            override fun onOpen(ws: WebSocket, resp: Response) {
                ws.send(JSONObject().apply {
                    put("type", "relay:auth")
                    put("roomId", gc.giftId)
                    put("authToken", gc.authToken)
                    put("role", "recipient")
                }.toString())
            }

            fun sendReq(ws: WebSocket) {
                if (reqSent) return
                reqSent = true
                ws.send(JSONObject().apply {
                    put("type", "relay:request")
                    put("requestId", requestId)
                    put("providerId", translation.dstProviderId)
                    put("url", urlString)
                    put("method", method)
                    put("headers", JSONObject(filteredHeaders))
                    put("body", translatedBody)
                }.toString())
            }

            override fun onMessage(ws: WebSocket, text: String) {
                try {
                    val json = JSONObject(text)
                    when (json.optString("type")) {
                        "relay:auth:result" -> {
                            if (json.optBoolean("success")) {
                                authenticated = true
                                if (json.optBoolean("peerOnline", false)) sendReq(ws)
                            } else {
                                onClose(Exception("Gift auth failed"))
                                ws.close(1000, null)
                            }
                        }
                        "relay:peer:status" -> {
                            if (json.optBoolean("online") && authenticated && !reqSent) sendReq(ws)
                        }
                        "relay:response:meta" -> {
                            if (json.optString("requestId") == requestId) {
                                val status = json.optInt("status")
                                isUpstreamError = status !in 200..299
                                if (!isUpstreamError && isStreaming) {
                                    try {
                                        streamHandle = engine.createStreamTranslator(ctxJson)
                                    } catch (t: Throwable) {
                                        onClose(t)
                                        ws.close(1000, null)
                                    }
                                }
                            }
                        }
                        "relay:response:chunk" -> {
                            if (json.optString("requestId") == requestId) {
                                val chunk = json.optString("chunk", "")
                                val handle = streamHandle
                                if (isUpstreamError) {
                                    onChunk(chunk.toByteArray(Charsets.UTF_8))
                                } else if (handle != null) {
                                    try {
                                        val translated = engine.processStreamChunk(handle, chunk)
                                        if (translated.isNotEmpty()) {
                                            onChunk(translated.toByteArray(Charsets.UTF_8))
                                        }
                                    } catch (t: Throwable) {
                                        onClose(t)
                                        releaseHandle()
                                        ws.close(1000, null)
                                    }
                                } else {
                                    accumulated.append(chunk)
                                }
                            }
                        }
                        "relay:response:done" -> {
                            if (json.optString("requestId") == requestId) {
                                val handle = streamHandle
                                try {
                                    if (handle != null) {
                                        val trailing = engine.flushStreamTranslator(handle)
                                        if (trailing.isNotEmpty()) {
                                            onChunk(trailing.toByteArray(Charsets.UTF_8))
                                        }
                                    } else if (!isUpstreamError && !isStreaming) {
                                        val translated = engine.translateResponse(ctxJson, accumulated.toString())
                                        onChunk(translated.toByteArray(Charsets.UTF_8))
                                    }
                                } catch (t: Throwable) {
                                    onClose(t)
                                    releaseHandle()
                                    ws.close(1000, null)
                                    return
                                } finally {
                                    releaseHandle()
                                }
                                Thread { Thread.sleep(2000); ws.close(1000, null) }.start()
                                onClose(null)
                            }
                        }
                        "relay:response:error" -> {
                            if (json.optString("requestId") == requestId) {
                                val msg = json.optJSONObject("error")?.optString("message") ?: "Gift relay error"
                                releaseHandle()
                                onClose(Exception(msg))
                                ws.close(1000, null)
                            }
                        }
                        "relay:usage" -> {
                            if (json.optString("giftId") == gc.giftId) {
                                wallet.updateGiftedCredentialUsage(gc.giftId, json.optInt("usedTokens"))
                            }
                        }
                    }
                } catch (_: Exception) {}
            }

            override fun onFailure(ws: WebSocket, t: Throwable, resp: Response?) {
                releaseHandle()
                onClose(Exception("Gift relay failed: ${t.message}"))
            }
        })
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

    private fun injectClaudeCodeSystemPrompt(body: ByteArray): ByteArray {
        return try {
            val parsed = org.json.JSONObject(String(body, Charsets.UTF_8))
            val prefix = "You are Claude Code, Anthropic's official CLI for Claude."
            val existing = parsed.optString("system", "").takeIf { it.isNotEmpty() }
            if (existing == null) {
                parsed.put("system", prefix)
            } else {
                parsed.put("system", "$prefix\n\n$existing")
            }
            parsed.toString().toByteArray(Charsets.UTF_8)
        } catch (_: Exception) {
            body
        }
    }

    private fun applyAuth(
        headers: MutableMap<String, String>,
        providerId: String,
        authMethod: AuthMethod,
        apiKey: String,
    ) {
        // Azure OpenAI uses an `api-key` header, not Bearer auth. Mirrors the
        // extension's behavior in proxy-utils.ts:71. Without this special case
        // mobile sends the wrong header and Azure responds with 401.
        if (providerId == "azure_openai") {
            headers["api-key"] = apiKey
            return
        }
        // Gemini uses `x-goog-api-key` (header is safer than ?key= query param,
        // which gets sanitized out of logs).
        if (providerId == "gemini") {
            headers["x-goog-api-key"] = apiKey
            return
        }
        if (providerId == "anthropic" && authMethod == AuthMethod.OAUTH) {
            headers["Authorization"] = "Bearer $apiKey"
            headers["User-Agent"] = "claude-cli/2.1.76"
            headers["x-app"] = "cli"
            if (!headers.containsKey("Accept") && !headers.containsKey("accept")) {
                headers["Accept"] = "application/json"
            }
            val oauthBeta = listOf(
                "claude-code-20250219",
                "oauth-2025-04-20",
                "fine-grained-tool-streaming-2025-05-14",
                "interleaved-thinking-2025-05-14",
            )
            val existing = (headers["anthropic-beta"] ?: "")
                .split(",")
                .map { it.trim() }
                .filter { it.isNotEmpty() }
            val merged = (existing + oauthBeta).distinct().sorted()
            headers["anthropic-beta"] = merged.joinToString(",")
            headers["anthropic-dangerous-direct-browser-access"] = "true"
        } else if (providerId == "anthropic") {
            headers["x-api-key"] = apiKey
        } else {
            headers["Authorization"] = "Bearer $apiKey"
        }
    }

    companion object {
        // Note: this set tracks providers that need stream_options injection
        // for token usage in streaming responses. Uses the canonical
        // azure_openai id (underscore) — the legacy hyphenated form has
        // been removed from the registry as of Phase 0.
        private val STREAM_USAGE_PROVIDERS = setOf("openai", "azure_openai", "together", "deepseek")
        val SENSITIVE_RESPONSE_HEADERS = setOf(
            "server", "x-request-id", "x-cloud-trace-context",
            "set-cookie", "set-cookie2", "alt-svc", "via",
        )
    }
}
