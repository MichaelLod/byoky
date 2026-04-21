package com.byoky.app.relay

import android.util.Base64
import com.byoky.app.data.GiftedCredential
import com.byoky.app.data.Provider
import com.byoky.app.data.WalletStore
import com.byoky.app.data.isGiftExpired
import com.byoky.app.proxy.ProxyService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

enum class PairStatus {
    IDLE, CONNECTING, PAIRED, ERROR;

    var appOrigin: String? = null
    var errorMessage: String? = null
}

data class PairPayload(
    val relayUrl: String,
    val roomId: String,
    val authToken: String,
    val appOrigin: String,
) {
    companion object {
        fun decode(encoded: String): PairPayload? {
            return try {
                val base64 = encoded
                    .replace("-", "+")
                    .replace("_", "/")
                    .let {
                        val remainder = it.length % 4
                        if (remainder > 0) it + "=".repeat(4 - remainder) else it
                    }
                val data = Base64.decode(base64, Base64.DEFAULT)
                val json = JSONObject(String(data, Charsets.UTF_8))
                if (json.optInt("v") != 1) return null
                PairPayload(
                    relayUrl = json.getString("r"),
                    roomId = json.getString("id"),
                    authToken = json.getString("t"),
                    appOrigin = json.getString("o"),
                )
            } catch (_: Exception) {
                null
            }
        }
    }
}

class RelayPairService(private val appContext: android.content.Context? = null) {
    private val _status = MutableStateFlow(PairStatus.IDLE)
    val status: StateFlow<PairStatus> = _status.asStateFlow()

    private val _requestCount = MutableStateFlow(0)
    val requestCount: StateFlow<Int> = _requestCount.asStateFlow()

    private var webSocket: WebSocket? = null
    private var wallet: WalletStore? = null
    private var pairedOrigin: String? = null
    private var lastPayload: PairPayload? = null
    private var pairAckTimeout: kotlinx.coroutines.Job? = null
    private val scope = CoroutineScope(Dispatchers.IO)

    /** Translation engine for cross-family routing on relay-routed requests.
     *  Lazy because TranslationEngine.get(context) needs an Android context;
     *  if construction was without one, translation is silently disabled. */
    private val translationEngine: com.byoky.app.proxy.TranslationEngine? by lazy {
        appContext?.let { com.byoky.app.proxy.TranslationEngine.get(it) }
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .pingInterval(30, TimeUnit.SECONDS)
        .build()

    private val proxyClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    fun connect(payload: PairPayload, wallet: WalletStore) {
        this.wallet = wallet
        this.lastPayload = payload
        _status.value = PairStatus.CONNECTING

        if (!payload.relayUrl.startsWith("wss://")) {
            _status.value = PairStatus.ERROR.also { it.errorMessage = "Relay must use a secure connection (wss://)" }
            return
        }

        val request = Request.Builder().url(payload.relayUrl).build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                val auth = JSONObject().apply {
                    put("type", "relay:auth")
                    put("roomId", payload.roomId)
                    put("authToken", payload.authToken)
                    put("role", "sender")
                }
                ws.send(auth.toString())
            }

            override fun onMessage(ws: WebSocket, text: String) {
                try {
                    val json = JSONObject(text)
                    val type = json.optString("type")
                    handleMessage(type, json, payload)
                } catch (_: Exception) {}
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                if (_status.value == PairStatus.PAIRED) {
                    _status.value = PairStatus.ERROR.also { it.errorMessage = "Connection lost" }
                }
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                if (_status.value == PairStatus.PAIRED) {
                    _status.value = PairStatus.ERROR.also { it.errorMessage = "Connection closed" }
                }
            }
        })
    }

    fun disconnect() {
        pairAckTimeout?.cancel()
        pairAckTimeout = null
        webSocket?.close(1000, null)
        webSocket = null
        pairedOrigin = null
        lastPayload = null
        _status.value = PairStatus.IDLE
        _requestCount.value = 0
    }

    fun reconnectIfNeeded() {
        val payload = lastPayload ?: return
        val wallet = wallet ?: return
        when (_status.value) {
            PairStatus.PAIRED -> connect(payload, wallet)
            PairStatus.ERROR -> connect(payload, wallet)
            else -> {}
        }
    }

    private fun handleMessage(type: String, json: JSONObject, payload: PairPayload) {
        when (type) {
            "relay:auth:result" -> {
                if (json.optBoolean("success")) {
                    sendPairHello()
                    sendVaultOffer(payload.appOrigin)
                    pairAckTimeout?.cancel()
                    pairAckTimeout = scope.launch {
                        kotlinx.coroutines.delay(30_000)
                        if (_status.value == PairStatus.CONNECTING) {
                            disconnect()
                            _status.value = PairStatus.ERROR.also { it.errorMessage = "Web app not responding — scan the QR code again" }
                        }
                    }
                } else {
                    val error = json.optString("error", "Auth failed")
                    _status.value = PairStatus.ERROR.also { it.errorMessage = error }
                }
            }
            "relay:pair:ack" -> {
                pairAckTimeout?.cancel()
                pairAckTimeout = null
                pairedOrigin = payload.appOrigin
                _status.value = PairStatus.PAIRED.also { it.appOrigin = payload.appOrigin }
                // Durable Session record so the app shows up in the Apps screen
                // across reconnects. The user revokes explicitly when done.
                // Providers list reflects what the wallet can currently serve;
                // gifted credentials are advertised separately via sendPairHello.
                wallet?.let { w ->
                    val providerIds = w.credentials.value.map { it.providerId }.distinct()
                    try {
                        w.upsertSession(payload.appOrigin, providerIds)
                    } catch (_: Exception) {
                        // Best-effort: pairing still succeeds even if persistence fails
                    }
                }
            }
            "relay:request" -> handleRelayRequest(json)
            "relay:peer:status" -> {
                // Intentionally no-op on offline. The relay keeps the room
                // alive for 5 min of idle and the browser rejoins with the
                // same authToken on refresh. Resetting to IDLE here broke the
                // first request after refresh because handleRelayRequest
                // guards on PAIRED.
            }
        }
    }

    private fun sendPairHello() {
        val wallet = wallet ?: return
        val providers = JSONObject()
        for (credential in wallet.credentials.value) {
            providers.put(credential.providerId, JSONObject().apply {
                put("available", true)
                put("authMethod", if (credential.authMethod == com.byoky.app.data.AuthMethod.API_KEY) "api_key" else "oauth")
            })
        }
        for (gc in wallet.giftedCredentials.value) {
            if (!providers.has(gc.providerId) && !isGiftExpired(gc.expiresAt) && gc.usedTokens < gc.maxTokens) {
                providers.put(gc.providerId, JSONObject().apply {
                    put("available", true)
                    put("authMethod", "api_key")
                })
            }
        }
        sendJSON(JSONObject().apply {
            put("type", "relay:pair:hello")
            put("providers", providers)
        })
    }

    private fun handleRelayRequest(json: JSONObject) {
        if (_status.value != PairStatus.PAIRED) return

        val wallet = this.wallet ?: return
        val requestId = json.optString("requestId") ?: return
        val providerId = json.optString("providerId") ?: return
        val urlString = json.optString("url") ?: return
        val method = json.optString("method") ?: return

        val origin = pairedOrigin ?: "relay"
        val allowanceCheck = wallet.checkAllowance(origin, providerId)
        if (!allowanceCheck.allowed) {
            sendRelayError(requestId, "QUOTA_EXCEEDED", allowanceCheck.reason ?: "Token allowance exceeded")
            return
        }

        val provider = Provider.find(providerId)
        if (provider == null) {
            sendRelayError(requestId, "NO_PROVIDER", "Unknown provider: $providerId")
            return
        }

        val requestHost = try { java.net.URL(urlString).host } catch (_: Exception) { null }
        // Azure OpenAI uses per-resource subdomains like
        // `mycompany.openai.azure.com`. Strict equality against the placeholder
        // baseUrl host would reject every real Azure URL. Mirrors the
        // extension's wildcard `*.openai.azure.com/*` host pattern.
        val hostOk = if (providerId == "azure_openai") {
            requestHost?.endsWith(".openai.azure.com") == true
        } else {
            requestHost == java.net.URL(provider.baseUrl).host
        }
        if (!hostOk) {
            sendRelayError(requestId, "INVALID_URL", "URL doesn't match provider")
            return
        }

        val headers = mutableMapOf<String, String>()
        val headersObj = json.optJSONObject("headers")
        headersObj?.keys()?.forEach { key ->
            headers[key] = headersObj.getString(key)
        }
        val bodyString = json.optString("body", "").takeIf { it.isNotEmpty() }

        scope.launch {
            _requestCount.value++
            try {
                // 0. Group gift pin. If the active group pins a specific gift
                // for this provider, short-circuit all routing — the gift's
                // relay carries the request end-to-end. Computed up front so
                // the fall-through logic below can consult it.
                val pairedOriginLocal = pairedOrigin ?: "relay"
                val groupForRouting = wallet.groupForOrigin(pairedOriginLocal)
                val pinnedGift: GiftedCredential? =
                    if (groupForRouting != null && groupForRouting.providerId == providerId && groupForRouting.giftId != null) {
                        wallet.giftedCredentials.value.firstOrNull {
                            it.giftId == groupForRouting.giftId
                                    && !isGiftExpired(it.expiresAt) && it.usedTokens < it.maxTokens
                        }
                    } else null

                // 0b. Cross-family gift route. The group pins a gift whose
                // provider differs from what the app requested, a model is
                // set, and the pair is translatable. Recipient translates
                // request+response, gift relay carries the translated call.
                val engineForProbe = translationEngine
                val srcModelForGift = com.byoky.app.proxy.RoutingResolver.parseModel(bodyString?.toByteArray(Charsets.UTF_8))
                val crossFamilyGift: Pair<GiftedCredential, com.byoky.app.data.RoutingTranslation>? = run {
                    if (pinnedGift != null) return@run null
                    if (groupForRouting == null) return@run null
                    if (groupForRouting.providerId == providerId) return@run null
                    val gid = groupForRouting.giftId ?: return@run null
                    val model = groupForRouting.model
                    if (model.isNullOrEmpty()) return@run null
                    if (srcModelForGift.isNullOrEmpty()) return@run null
                    if (engineForProbe == null) return@run null
                    if (!engineForProbe.shouldTranslate(providerId, groupForRouting.providerId)) return@run null
                    val gc = wallet.giftedCredentials.value.firstOrNull {
                        it.giftId == gid && !isGiftExpired(it.expiresAt) && it.usedTokens < it.maxTokens
                    } ?: return@run null
                    gc to com.byoky.app.data.RoutingTranslation(
                        srcProviderId = providerId,
                        dstProviderId = groupForRouting.providerId,
                        srcModel = srcModelForGift,
                        dstModel = model,
                    )
                }

                if (crossFamilyGift != null) {
                    val (gc, translation) = crossFamilyGift
                    proxyRelayRequestViaGiftWithTranslation(
                        gc = gc,
                        translation = translation,
                        requestId = requestId,
                        originalProviderId = providerId,
                        method = method,
                        headers = headers,
                        bodyString = bodyString,
                    )
                    return@launch
                }

                // Resolve routing FIRST. The routing resolver inspects the
                // group for this origin and decides between: cross-family
                // translation, same-family swap, direct credential lookup,
                // or no-match (returns null). Putting this before the gift /
                // ownCred checks matches the extension's resolution order
                // and lets routing rescue requests that would otherwise hit
                // NO_CREDENTIAL (the app calls provider X but the user only
                // has a credential for provider Y in the same family).
                // Translation & swap are skipped when a gift is pinned —
                // gifts carry their own relay/endpoint so routing is moot.
                val routing = if (pinnedGift == null) resolveRelayRouting(providerId, bodyString) else null

                // 1. Cross-family translation path.
                if (routing != null && routing.translation != null) {
                    handleRelayRequestWithTranslation(
                        requestId = requestId,
                        originalProviderId = providerId,
                        translation = routing.translation,
                        routedCredential = routing.credential,
                        method = method,
                        headers = headers,
                        bodyString = bodyString,
                    )
                    return@launch
                }

                // 2. Same-family swap path. Two providers in the same family
                // (e.g. Groq → OpenAI) speak identical wire formats, so we
                // skip translation entirely and just rewrite URL + swap key
                // + (optionally) override the body's model field.
                if (routing != null && routing.swapToProviderId != null) {
                    handleRelayRequestWithSwap(
                        requestId = requestId,
                        originalProviderId = providerId,
                        swapToProviderId = routing.swapToProviderId,
                        swapDstModel = routing.swapDstModel,
                        routedCredential = routing.credential,
                        method = method,
                        headers = headers,
                        bodyString = bodyString,
                    )
                    return@launch
                }

                // 3. Pass-through. Either routing returned a direct-match
                // credential (routing.credential.providerId == providerId),
                // or routing returned null (no match). Gift preferences still
                // apply here — a user can explicitly prefer a gift over
                // their own key for a given provider. A group-pinned gift
                // (computed above as `pinnedGift`) overrides both.
                val prefs = wallet.giftPreferences.value
                val giftedCreds = wallet.giftedCredentials.value
                val ownCred = routing?.credential

                var useGift: GiftedCredential? = pinnedGift
                if (useGift == null) {
                    val preferredGiftId = prefs[providerId]
                    if (preferredGiftId != null) {
                        useGift = giftedCreds.firstOrNull {
                            it.giftId == preferredGiftId && it.providerId == providerId
                                    && !isGiftExpired(it.expiresAt) && it.usedTokens < it.maxTokens
                        }
                    }
                    if (useGift == null && ownCred == null) {
                        useGift = giftedCreds.firstOrNull {
                            it.providerId == providerId && !isGiftExpired(it.expiresAt) && it.usedTokens < it.maxTokens
                        }
                    }
                }

                if (useGift != null) {
                    proxyRelayRequestViaGift(useGift, requestId, providerId, urlString, method, headers, bodyString)
                    return@launch
                }

                if (ownCred == null) {
                    // No direct credential AND no routing rule fired AND no
                    // usable gift picked up. Build an actionable message
                    // listing own credentials + gifts so it's clear whether
                    // a gift is present but not being used (bug) vs. missing.
                    val uniqueCreds = wallet.credentials.value
                        .map { it.providerId }
                        .distinct()
                        .sorted()
                    val giftedIds = wallet.giftedCredentials.value
                        .filter { !isGiftExpired(it.expiresAt) && it.usedTokens < it.maxTokens }
                        .map { it.providerId }
                        .distinct()
                        .sorted()
                    val originForLookup = pairedOrigin ?: "relay"
                    val group = wallet.groupForOrigin(originForLookup)
                    val message = buildNoCredentialMessage(
                        requestedProviderId = providerId,
                        userCredentialProviderIds = uniqueCreds,
                        giftedProviderIds = giftedIds,
                        group = group,
                    )
                    sendRelayError(requestId, "NO_CREDENTIAL", message)
                    return@launch
                }

                val apiKey = wallet.decryptKey(ownCred)

                val filteredHeaders = headers.filterKeys {
                    it.lowercase() !in setOf("host", "authorization", "x-api-key")
                }.toMutableMap()

                applyAuth(filteredHeaders, providerId, ownCred.authMethod, apiKey, bodyString)

                // Group-pinned model wins over the SDK's choice even on the
                // direct path (same provider, no translation/swap needed).
                val bodyWithModel = routing?.modelOverride?.let { override ->
                    rewriteModelInJsonBody(bodyString, override)
                } ?: bodyString

                // Claude-Code request-shape compatibility transforms (Anthropic
                // OAuth setup tokens only). Rewrites non-PascalCase tool names
                // to Claude-Code aliases and relocates the framework's system
                // prompt into a <system_context> block inside the first user
                // message. The returned toolNameMap drives the response-path
                // rewriter so the upstream framework sees its original names.
                // Falls back to the plain prefix prepend if the JS bridge is
                // unavailable (e.g. older Android with no WebView sandbox).
                var ccToolNameMap: Map<String, String> = emptyMap()
                val finalBody = if (providerId == "anthropic" &&
                        ownCred.authMethod == com.byoky.app.data.AuthMethod.OAUTH &&
                        bodyWithModel != null) {
                    val engine = translationEngine
                    if (engine != null && engine.isSupported) {
                        try {
                            val prepared = engine.prepareClaudeCodeBody(bodyWithModel)
                            ccToolNameMap = prepared.toolNameMap
                            prepared.body
                        } catch (_: Throwable) {
                            // JS bridge failure — fall back to prefix prepend.
                            applyPrefixFallback(bodyWithModel)
                        }
                    } else {
                        applyPrefixFallback(bodyWithModel)
                    }
                } else {
                    bodyWithModel
                }

                val injectedBody = injectStreamUsageOptions(providerId, finalBody)

                val requestBody = if (injectedBody != null && method.uppercase() in setOf("POST", "PUT", "PATCH")) {
                    val contentType = filteredHeaders["content-type"] ?: "application/json"
                    injectedBody.toByteArray(Charsets.UTF_8)
                        .toRequestBody(contentType.toMediaTypeOrNull())
                } else null

                val request = Request.Builder()
                    .url(urlString)
                    .method(method.uppercase(), requestBody)
                    .apply {
                        filteredHeaders.forEach { (k, v) ->
                            addHeader(k, v)
                        }
                    }
                    .build()

                val response = proxyClient.newCall(request).execute()

                val responseHeaders = JSONObject()
                response.headers.forEach { (name, value) ->
                    if (name.lowercase() !in ProxyService.SENSITIVE_RESPONSE_HEADERS) {
                        responseHeaders.put(name.lowercase(), value)
                    }
                }

                sendJSON(JSONObject().apply {
                    put("type", "relay:response:meta")
                    put("requestId", requestId)
                    put("status", response.code)
                    put("statusText", response.message)
                    put("headers", responseHeaders)
                })

                // If Claude-Code tool name rewriting was applied to the
                // request, we need to translate tool_use.name back in the
                // response before forwarding to OpenClaw. SSE streams go
                // through a stateful rewriter (chunk-by-chunk); JSON
                // responses are buffered and rewritten at the end.
                val contentType = response.headers["content-type"]?.lowercase() ?: ""
                val isSSE = contentType.contains("text/event-stream")
                val rewriteEngine = translationEngine
                val sseHandle = if (ccToolNameMap.isNotEmpty() && isSSE && rewriteEngine != null) {
                    try { rewriteEngine.createClaudeCodeSSERewriter(ccToolNameMap) } catch (_: Throwable) { null }
                } else null

                val body = response.body
                val fullResponse = StringBuilder()
                if (body != null) {
                    val source = body.source()
                    val buffer = StringBuilder()
                    while (!source.exhausted()) {
                        val byte = source.readByte()
                        val char = byte.toInt().toChar()
                        buffer.append(char)
                        fullResponse.append(char)
                        if (buffer.length >= 4096 || char == '\n') {
                            val outChunk = if (sseHandle != null && rewriteEngine != null) {
                                try { rewriteEngine.processClaudeCodeSSE(sseHandle, buffer.toString()) }
                                catch (_: Throwable) { buffer.toString() }
                            } else {
                                buffer.toString()
                            }
                            if (outChunk.isNotEmpty()) {
                                sendJSON(JSONObject().apply {
                                    put("type", "relay:response:chunk")
                                    put("requestId", requestId)
                                    put("chunk", outChunk)
                                })
                            }
                            buffer.clear()
                        }
                    }
                    if (buffer.isNotEmpty()) {
                        val outChunk = if (sseHandle != null && rewriteEngine != null) {
                            try { rewriteEngine.processClaudeCodeSSE(sseHandle, buffer.toString()) }
                            catch (_: Throwable) { buffer.toString() }
                        } else {
                            buffer.toString()
                        }
                        if (outChunk.isNotEmpty()) {
                            sendJSON(JSONObject().apply {
                                put("type", "relay:response:chunk")
                                put("requestId", requestId)
                                put("chunk", outChunk)
                            })
                        }
                    }
                    // Flush any trailing SSE buffer (leftover partial frame) and release the handle.
                    if (sseHandle != null && rewriteEngine != null) {
                        val tail = try { rewriteEngine.flushClaudeCodeSSE(sseHandle) } catch (_: Throwable) { "" }
                        if (tail.isNotEmpty()) {
                            sendJSON(JSONObject().apply {
                                put("type", "relay:response:chunk")
                                put("requestId", requestId)
                                put("chunk", tail)
                            })
                        }
                    }
                    body.close()
                }

                sendJSON(JSONObject().apply {
                    put("type", "relay:response:done")
                    put("requestId", requestId)
                })

                val logOrigin = pairedOrigin ?: "relay"
                wallet.logRequest(
                    appOrigin = logOrigin,
                    providerId = providerId,
                    method = method,
                    url = urlString,
                    statusCode = response.code,
                    requestBody = bodyString?.toByteArray(Charsets.UTF_8),
                    responseBody = fullResponse.toString(),
                )
            } catch (e: Exception) {
                sendRelayError(requestId, "PROXY_ERROR", e.message ?: "Unknown error")
            }
        }
    }

    /**
     * Cross-family routing for relay-routed requests. Uses pairedOrigin (the
     * desktop app's actual origin) for the group lookup, so per-app routing
     * is fully functional via the relay path. Returns null when there's no
     * translation engine, no group, same family, or no credential.
     */
    private fun resolveRelayRouting(
        requestedProviderId: String,
        bodyString: String?,
    ): com.byoky.app.data.RoutingDecision? {
        val engine = translationEngine ?: return null
        val w = wallet ?: return null
        val origin = pairedOrigin ?: return null
        val group = w.groupForOrigin(origin) ?: return null
        val srcModel = com.byoky.app.proxy.RoutingResolver.parseModel(bodyString?.toByteArray(Charsets.UTF_8))
        return com.byoky.app.proxy.RoutingResolver.resolve(
            requestedProviderId = requestedProviderId,
            requestedModel = srcModel,
            group = group,
            credentials = w.credentials.value,
            engine = engine,
        )
    }

    /**
     * Cross-family translation path for relay-routed requests. Mirrors the
     * pass-through relay flow but inserts: translateRequest before send,
     * destination URL via rewriteProxyUrl, destination credential auth, and
     * translateResponse / stream translator on the response chunks.
     */
    private fun handleRelayRequestWithTranslation(
        requestId: String,
        originalProviderId: String,
        translation: com.byoky.app.data.RoutingTranslation,
        routedCredential: com.byoky.app.data.Credential,
        method: String,
        headers: Map<String, String>,
        bodyString: String?,
    ) {
        val wallet = wallet ?: return
        val engine = translationEngine ?: return
        val isStreaming = com.byoky.app.proxy.RoutingResolver.isStreamingRequest(bodyString?.toByteArray(Charsets.UTF_8))

        try {
            val ctxJson = engine.buildTranslationContext(
                srcProviderId = translation.srcProviderId,
                dstProviderId = translation.dstProviderId,
                srcModel = translation.srcModel,
                dstModel = translation.dstModel,
                isStreaming = isStreaming,
                requestId = requestId,
            )
            val translatedBody = engine.translateRequest(ctxJson, bodyString ?: "")
            val urlString = engine.rewriteProxyUrl(translation.dstProviderId, translation.dstModel, isStreaming)
                ?: run {
                    sendRelayError(requestId, "TRANSLATION_FAILED", "rewriteProxyUrl returned null")
                    return
                }

            val dstApiKey = wallet.decryptKey(routedCredential)

            val filteredHeaders = headers.filterKeys {
                it.lowercase() !in setOf("host", "authorization", "x-api-key", "anthropic-version", "content-length")
            }.toMutableMap()
            applyAuth(filteredHeaders, translation.dstProviderId, routedCredential.authMethod, dstApiKey, translatedBody)

            val injectedBody = injectStreamUsageOptions(translation.dstProviderId, translatedBody) ?: translatedBody
            val requestBody = injectedBody.toByteArray(Charsets.UTF_8)
                .toRequestBody((filteredHeaders["content-type"] ?: "application/json").toMediaTypeOrNull())

            val request = Request.Builder()
                .url(urlString)
                .method(method.uppercase(), requestBody)
                .apply { filteredHeaders.forEach { (k, v) -> addHeader(k, v) } }
                .build()

            val response = proxyClient.newCall(request).execute()
            val responseHeaders = JSONObject()
            response.headers.forEach { (name, value) ->
                if (name.lowercase() !in ProxyService.SENSITIVE_RESPONSE_HEADERS) {
                    responseHeaders.put(name.lowercase(), value)
                }
            }

            sendJSON(JSONObject().apply {
                put("type", "relay:response:meta")
                put("requestId", requestId)
                put("status", response.code)
                put("statusText", response.message)
                put("headers", responseHeaders)
            })

            val body = response.body
            if (body == null) {
                sendJSON(JSONObject().apply {
                    put("type", "relay:response:done")
                    put("requestId", requestId)
                })
                return
            }

            // Non-2xx: pass body through verbatim. Don't try to translate
            // error bodies — they're rarely shaped like the source dialect.
            if (response.code !in 200..299) {
                val source = body.source()
                val buffer = StringBuilder()
                while (!source.exhausted()) {
                    val byte = source.readByte()
                    val char = byte.toInt().toChar()
                    buffer.append(char)
                    if (buffer.length >= 4096 || char == '\n') {
                        sendJSON(JSONObject().apply {
                            put("type", "relay:response:chunk")
                            put("requestId", requestId)
                            put("chunk", buffer.toString())
                        })
                        buffer.clear()
                    }
                }
                if (buffer.isNotEmpty()) {
                    sendJSON(JSONObject().apply {
                        put("type", "relay:response:chunk")
                        put("requestId", requestId)
                        put("chunk", buffer.toString())
                    })
                }
                body.close()
                sendJSON(JSONObject().apply {
                    put("type", "relay:response:done")
                    put("requestId", requestId)
                })
                wallet.logRequest(
                    appOrigin = pairedOrigin ?: "relay",
                    providerId = originalProviderId,
                    method = method,
                    url = urlString,
                    statusCode = response.code,
                    requestBody = bodyString?.toByteArray(Charsets.UTF_8),
                    responseBody = null,
                    actualProviderId = translation.dstProviderId,
                    actualModel = translation.dstModel,
                    groupId = wallet.groupForOrigin(pairedOrigin ?: "relay")?.id,
                )
                return
            }

            // 2xx + streaming: feed each chunk through the stream translator,
            // forward translated chunks via relay protocol.
            // 2xx + non-streaming: accumulate full body, translateResponse,
            // send as one chunk.
            if (isStreaming) {
                val streamHandle = engine.createStreamTranslator(ctxJson)
                var releasedExplicitly = false
                try {
                    val source = body.source()
                    val buffer = ByteArray(4096)
                    while (!source.exhausted()) {
                        val read = source.read(buffer)
                        if (read > 0) {
                            val chunkString = String(buffer, 0, read, Charsets.UTF_8)
                            val translated = engine.processStreamChunk(streamHandle, chunkString)
                            if (translated.isNotEmpty()) {
                                sendJSON(JSONObject().apply {
                                    put("type", "relay:response:chunk")
                                    put("requestId", requestId)
                                    put("chunk", translated)
                                })
                            }
                        }
                    }
                    val trailing = engine.flushStreamTranslator(streamHandle)
                    releasedExplicitly = true
                    if (trailing.isNotEmpty()) {
                        sendJSON(JSONObject().apply {
                            put("type", "relay:response:chunk")
                            put("requestId", requestId)
                            put("chunk", trailing)
                        })
                    }
                } finally {
                    if (!releasedExplicitly) engine.releaseStreamTranslator(streamHandle)
                    body.close()
                }
            } else {
                val rawResponse = body.string()
                val translated = engine.translateResponse(ctxJson, rawResponse)
                sendJSON(JSONObject().apply {
                    put("type", "relay:response:chunk")
                    put("requestId", requestId)
                    put("chunk", translated)
                })
            }

            sendJSON(JSONObject().apply {
                put("type", "relay:response:done")
                put("requestId", requestId)
            })

            wallet.logRequest(
                appOrigin = pairedOrigin ?: "relay",
                providerId = originalProviderId,
                method = method,
                url = urlString,
                statusCode = response.code,
                requestBody = bodyString?.toByteArray(Charsets.UTF_8),
                responseBody = null,
                actualProviderId = translation.dstProviderId,
                actualModel = translation.dstModel,
                groupId = wallet.groupForOrigin(pairedOrigin ?: "relay")?.id,
            )
        } catch (t: Throwable) {
            sendRelayError(requestId, "TRANSLATION_FAILED", t.message ?: "translation failed")
        }
    }

    /**
     * Same-family swap path for relay-routed requests. Two providers in the
     * same translation family (e.g. Groq → OpenAI) share an identical wire
     * format, so we skip the JS translation bridge entirely and just:
     *   - rewrite the upstream URL to the destination provider's chat endpoint
     *   - (optionally) override the request body's `model` field when the
     *     group pins a specific destination model
     *   - swap in the destination credential for auth
     *   - forward the response bytes unchanged
     *
     * Strictly simpler than [handleRelayRequestWithTranslation] — no
     * translateRequest, no stream translator, no translateResponse.
     */
    private fun handleRelayRequestWithSwap(
        requestId: String,
        originalProviderId: String,
        swapToProviderId: String,
        swapDstModel: String?,
        routedCredential: com.byoky.app.data.Credential,
        method: String,
        headers: Map<String, String>,
        bodyString: String?,
    ) {
        val wallet = wallet ?: return
        val engine = translationEngine ?: run {
            sendRelayError(requestId, "SWAP_FAILED", "translation engine unavailable")
            return
        }
        val isStreaming = com.byoky.app.proxy.RoutingResolver.isStreamingRequest(bodyString?.toByteArray(Charsets.UTF_8))
        // Pass the group's pinned dst model to URL builder if present, else
        // fall back to whatever the SDK sent. Same-family openai providers
        // ignore the model in the URL (it rides on the body), but passing a
        // real value keeps rewriteProxyUrl honest.
        val modelForUrl = swapDstModel
            ?: com.byoky.app.proxy.RoutingResolver.parseModel(bodyString?.toByteArray(Charsets.UTF_8))
            ?: ""

        try {
            val urlString = engine.rewriteProxyUrl(swapToProviderId, modelForUrl, isStreaming)
                ?: run {
                    sendRelayError(requestId, "SWAP_FAILED", "rewriteProxyUrl returned null for $swapToProviderId")
                    return
                }

            // Substitute the body's `model` field with the group's pinned
            // destination model when set. Same-family providers all accept
            // a JSON body with a top-level `model` string, so a surgical
            // JSON edit is safe and minimal.
            val forwardedBody = if (!swapDstModel.isNullOrEmpty()) {
                rewriteModelInJsonBody(bodyString, swapDstModel)
            } else {
                bodyString
            }
            val injectedBody = injectStreamUsageOptions(swapToProviderId, forwardedBody) ?: forwardedBody

            val dstApiKey = wallet.decryptKey(routedCredential)

            val filteredHeaders = headers.filterKeys {
                it.lowercase() !in setOf("host", "authorization", "x-api-key", "anthropic-version", "content-length")
            }.toMutableMap()
            applyAuth(filteredHeaders, swapToProviderId, routedCredential.authMethod, dstApiKey, injectedBody)

            val requestBody = if (injectedBody != null && method.uppercase() in setOf("POST", "PUT", "PATCH")) {
                val contentType = filteredHeaders["content-type"] ?: "application/json"
                injectedBody.toByteArray(Charsets.UTF_8).toRequestBody(contentType.toMediaTypeOrNull())
            } else null

            val request = Request.Builder()
                .url(urlString)
                .method(method.uppercase(), requestBody)
                .apply { filteredHeaders.forEach { (k, v) -> addHeader(k, v) } }
                .build()

            val response = proxyClient.newCall(request).execute()

            val responseHeaders = JSONObject()
            response.headers.forEach { (name, value) ->
                if (name.lowercase() !in ProxyService.SENSITIVE_RESPONSE_HEADERS) {
                    responseHeaders.put(name.lowercase(), value)
                }
            }
            sendJSON(JSONObject().apply {
                put("type", "relay:response:meta")
                put("requestId", requestId)
                put("status", response.code)
                put("statusText", response.message)
                put("headers", responseHeaders)
            })

            // Forward the response body verbatim (success or error — no
            // translation). Wire formats are identical on both sides.
            val body = response.body
            val fullResponse = StringBuilder()
            if (body != null) {
                val source = body.source()
                val buffer = StringBuilder()
                while (!source.exhausted()) {
                    val byte = source.readByte()
                    val char = byte.toInt().toChar()
                    buffer.append(char)
                    fullResponse.append(char)
                    if (buffer.length >= 4096 || char == '\n') {
                        sendJSON(JSONObject().apply {
                            put("type", "relay:response:chunk")
                            put("requestId", requestId)
                            put("chunk", buffer.toString())
                        })
                        buffer.clear()
                    }
                }
                if (buffer.isNotEmpty()) {
                    sendJSON(JSONObject().apply {
                        put("type", "relay:response:chunk")
                        put("requestId", requestId)
                        put("chunk", buffer.toString())
                    })
                }
                body.close()
            }
            sendJSON(JSONObject().apply {
                put("type", "relay:response:done")
                put("requestId", requestId)
            })

            val logOrigin = pairedOrigin ?: "relay"
            wallet.logRequest(
                appOrigin = logOrigin,
                providerId = originalProviderId,
                method = method,
                url = urlString,
                statusCode = response.code,
                requestBody = bodyString?.toByteArray(Charsets.UTF_8),
                responseBody = fullResponse.toString(),
                actualProviderId = swapToProviderId,
                actualModel = swapDstModel,
                groupId = wallet.groupForOrigin(logOrigin)?.id,
            )
        } catch (t: Throwable) {
            sendRelayError(requestId, "PROXY_ERROR", t.message ?: "Unknown error")
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

    /** Fallback when the JS bridge isn't available: prepend the bare Claude
     *  Code prefix to the system field. Older behavior — good enough for
     *  requests that don't carry framework-specific tool vocabularies. */
    private fun applyPrefixFallback(body: String): String {
        return try {
            val parsed = JSONObject(body)
            val prefix = "You are Claude Code, Anthropic's official CLI for Claude."
            val existing = parsed.optString("system", "").takeIf { it.isNotEmpty() }
            if (existing == null) parsed.put("system", prefix)
            else parsed.put("system", "$prefix\n\n$existing")
            parsed.toString()
        } catch (_: Exception) { body }
    }

    private fun proxyRelayRequestViaGift(
        gc: GiftedCredential,
        requestId: String,
        providerId: String,
        url: String,
        method: String,
        headers: Map<String, String>,
        bodyString: String?,
    ) {
        val filteredHeaders = headers.filterKeys {
            it.lowercase() !in setOf("host", "authorization", "x-api-key")
        }

        val wsReq = Request.Builder().url(gc.relayUrl).build()
        proxyClient.newWebSocket(wsReq, object : WebSocketListener() {
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
                    bodyString?.let { put("body", it) }
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
                                sendRelayError(requestId, "GIFT_AUTH_FAILED", "Gift auth failed")
                                ws.close(1000, null)
                            }
                        }
                        "relay:peer:status" -> {
                            if (json.optBoolean("online") && authenticated && !reqSent) sendReq(ws)
                        }
                        "relay:response:meta" -> {
                            if (json.optString("requestId") == requestId) {
                                val hdrs = json.optJSONObject("headers")
                                val filteredHdrs = JSONObject()
                                hdrs?.keys()?.forEach { k ->
                                    if (k.lowercase() !in ProxyService.SENSITIVE_RESPONSE_HEADERS) {
                                        filteredHdrs.put(k.lowercase(), hdrs.getString(k))
                                    }
                                }
                                sendJSON(JSONObject().apply {
                                    put("type", "relay:response:meta")
                                    put("requestId", requestId)
                                    put("status", json.optInt("status"))
                                    put("statusText", json.optString("statusText", ""))
                                    put("headers", filteredHdrs)
                                })
                            }
                        }
                        "relay:response:chunk" -> {
                            if (json.optString("requestId") == requestId) {
                                sendJSON(JSONObject().apply {
                                    put("type", "relay:response:chunk")
                                    put("requestId", requestId)
                                    put("chunk", json.optString("chunk", ""))
                                })
                            }
                        }
                        "relay:response:done" -> {
                            if (json.optString("requestId") == requestId) {
                                sendJSON(JSONObject().apply {
                                    put("type", "relay:response:done")
                                    put("requestId", requestId)
                                })
                                Thread { Thread.sleep(2000); ws.close(1000, null) }.start()
                            }
                        }
                        "relay:response:error" -> {
                            if (json.optString("requestId") == requestId) {
                                val upstream = json.optJSONObject("error")
                                sendJSON(JSONObject().apply {
                                    put("type", "relay:response:error")
                                    put("requestId", requestId)
                                    put("error", upstream ?: JSONObject().apply {
                                        put("code", "GIFT_ERROR")
                                        put("message", "Gift relay error")
                                    })
                                })
                                if (upstream?.optString("code") == "GIFT_EXPIRED") {
                                    wallet?.removeGiftedCredential(gc.id)
                                }
                                ws.close(1000, null)
                            }
                        }
                        "relay:usage" -> {
                            if (json.optString("giftId") == gc.giftId) {
                                wallet?.updateGiftedCredentialUsage(gc.giftId, json.optInt("usedTokens"))
                            }
                        }
                    }
                } catch (_: Exception) {}
            }

            override fun onFailure(ws: WebSocket, t: Throwable, resp: Response?) {
                sendRelayError(requestId, "GIFT_RELAY_ERROR", "Gift relay failed: ${t.message}")
            }
        })
    }

    /**
     * Cross-family translation via a gift relay. Mirrors
     * [proxyRelayRequestViaGift] but translates the request body src → dst
     * before sending and wraps response chunks with the JS-bridge stream
     * translator (streaming) or buffers and translates at done-time
     * (non-streaming). Non-2xx bodies pass through verbatim.
     */
    private fun proxyRelayRequestViaGiftWithTranslation(
        gc: GiftedCredential,
        translation: com.byoky.app.data.RoutingTranslation,
        requestId: String,
        originalProviderId: String,
        method: String,
        headers: Map<String, String>,
        bodyString: String?,
    ) {
        val wallet = wallet ?: return
        val engine = translationEngine ?: run {
            sendRelayError(requestId, "TRANSLATION_FAILED", "translation engine unavailable")
            return
        }
        val isStreaming = com.byoky.app.proxy.RoutingResolver.isStreamingRequest(bodyString?.toByteArray(Charsets.UTF_8))

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
            translatedBody = engine.translateRequest(ctxJson, bodyString ?: "")
            urlString = engine.rewriteProxyUrl(translation.dstProviderId, translation.dstModel, isStreaming)
                ?: run {
                    sendRelayError(requestId, "TRANSLATION_FAILED", "rewriteProxyUrl returned null")
                    return
                }
        } catch (t: Throwable) {
            sendRelayError(requestId, "TRANSLATION_FAILED", t.message ?: "translation failed")
            return
        }

        // Inject stream_options for openai-family providers that need it
        // so the sender's upstream call emits usage data.
        val finalBody = injectStreamUsageOptions(translation.dstProviderId, translatedBody) ?: translatedBody

        val filteredHeaders = headers.filterKeys {
            it.lowercase() !in setOf("host", "authorization", "x-api-key", "anthropic-version", "content-length")
        }

        val wsReq = Request.Builder().url(gc.relayUrl).build()
        proxyClient.newWebSocket(wsReq, object : WebSocketListener() {
            var authenticated = false
            var reqSent = false
            var isUpstreamError = false
            var receivedStatus = 0
            var streamHandle: Int? = null
            var handleReleased = false
            val accumulated = StringBuilder()

            fun releaseHandle() {
                streamHandle?.let {
                    if (!handleReleased) {
                        try { engine.releaseStreamTranslator(it) } catch (_: Throwable) {}
                        handleReleased = true
                    }
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
                    put("body", finalBody)
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
                                sendRelayError(requestId, "GIFT_AUTH_FAILED", "Gift auth failed")
                                ws.close(1000, null)
                            }
                        }
                        "relay:peer:status" -> {
                            if (json.optBoolean("online") && authenticated && !reqSent) sendReq(ws)
                        }
                        "relay:response:meta" -> {
                            if (json.optString("requestId") == requestId) {
                                receivedStatus = json.optInt("status")
                                isUpstreamError = receivedStatus !in 200..299
                                val hdrs = json.optJSONObject("headers")
                                val filteredHdrs = JSONObject()
                                hdrs?.keys()?.forEach { k ->
                                    if (k.lowercase() !in ProxyService.SENSITIVE_RESPONSE_HEADERS) {
                                        filteredHdrs.put(k.lowercase(), hdrs.getString(k))
                                    }
                                }
                                sendJSON(JSONObject().apply {
                                    put("type", "relay:response:meta")
                                    put("requestId", requestId)
                                    put("status", receivedStatus)
                                    put("statusText", json.optString("statusText", ""))
                                    put("headers", filteredHdrs)
                                })
                                if (!isUpstreamError && isStreaming) {
                                    try {
                                        streamHandle = engine.createStreamTranslator(ctxJson)
                                    } catch (t: Throwable) {
                                        sendRelayError(requestId, "TRANSLATION_FAILED", t.message ?: "stream translator init failed")
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
                                    sendJSON(JSONObject().apply {
                                        put("type", "relay:response:chunk")
                                        put("requestId", requestId)
                                        put("chunk", chunk)
                                    })
                                } else if (handle != null) {
                                    try {
                                        val translated = engine.processStreamChunk(handle, chunk)
                                        if (translated.isNotEmpty()) {
                                            sendJSON(JSONObject().apply {
                                                put("type", "relay:response:chunk")
                                                put("requestId", requestId)
                                                put("chunk", translated)
                                            })
                                        }
                                    } catch (t: Throwable) {
                                        sendRelayError(requestId, "TRANSLATION_FAILED", t.message ?: "stream chunk translation failed")
                                        releaseHandle()
                                        ws.close(1000, null)
                                    }
                                } else {
                                    // Non-streaming: buffer until done.
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
                                            sendJSON(JSONObject().apply {
                                                put("type", "relay:response:chunk")
                                                put("requestId", requestId)
                                                put("chunk", trailing)
                                            })
                                        }
                                    } else if (!isUpstreamError && !isStreaming) {
                                        val translated = engine.translateResponse(ctxJson, accumulated.toString())
                                        sendJSON(JSONObject().apply {
                                            put("type", "relay:response:chunk")
                                            put("requestId", requestId)
                                            put("chunk", translated)
                                        })
                                    }
                                } catch (t: Throwable) {
                                    sendRelayError(requestId, "TRANSLATION_FAILED", t.message ?: "response translation failed")
                                    releaseHandle()
                                    ws.close(1000, null)
                                    return
                                } finally {
                                    releaseHandle()
                                }
                                sendJSON(JSONObject().apply {
                                    put("type", "relay:response:done")
                                    put("requestId", requestId)
                                })
                                wallet.logRequest(
                                    appOrigin = pairedOrigin ?: "relay",
                                    providerId = originalProviderId,
                                    method = method,
                                    url = urlString,
                                    statusCode = receivedStatus,
                                    requestBody = bodyString?.toByteArray(Charsets.UTF_8),
                                    responseBody = null,
                                    actualProviderId = translation.dstProviderId,
                                    actualModel = translation.dstModel,
                                    groupId = wallet.groupForOrigin(pairedOrigin ?: "relay")?.id,
                                )
                                Thread { Thread.sleep(2000); ws.close(1000, null) }.start()
                            }
                        }
                        "relay:response:error" -> {
                            if (json.optString("requestId") == requestId) {
                                val upstream = json.optJSONObject("error")
                                sendJSON(JSONObject().apply {
                                    put("type", "relay:response:error")
                                    put("requestId", requestId)
                                    put("error", upstream ?: JSONObject().apply {
                                        put("code", "GIFT_ERROR")
                                        put("message", "Gift relay error")
                                    })
                                })
                                if (upstream?.optString("code") == "GIFT_EXPIRED") {
                                    wallet.removeGiftedCredential(gc.id)
                                }
                                releaseHandle()
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
                sendRelayError(requestId, "GIFT_RELAY_ERROR", "Gift relay failed: ${t.message}")
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                releaseHandle()
            }
        })
    }

    private fun injectStreamUsageOptions(providerId: String, body: String?): String? {
        if (body == null || providerId !in STREAM_USAGE_PROVIDERS) return body
        return try {
            val parsed = JSONObject(body)
            if (parsed.optBoolean("stream", false)) {
                val streamOptions = parsed.optJSONObject("stream_options") ?: JSONObject()
                if (!streamOptions.optBoolean("include_usage", false)) {
                    streamOptions.put("include_usage", true)
                    parsed.put("stream_options", streamOptions)
                    parsed.toString()
                } else body
            } else body
        } catch (_: Exception) { body }
    }

    private fun applyAuth(
        headers: MutableMap<String, String>,
        providerId: String,
        authMethod: com.byoky.app.data.AuthMethod,
        apiKey: String,
        bodyString: String?,
    ) {
        // Azure OpenAI uses an `api-key` header (not Bearer). Mirrors the
        // extension behavior in proxy-utils.ts:71. Without this special case
        // mobile sends the wrong header and Azure returns 401.
        if (providerId == "azure_openai") {
            headers["api-key"] = apiKey
            return
        }
        // Gemini uses `x-goog-api-key`.
        if (providerId == "gemini") {
            headers["x-goog-api-key"] = apiKey
            return
        }
        if (providerId == "anthropic" && authMethod == com.byoky.app.data.AuthMethod.OAUTH) {
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

    private fun sendRelayError(requestId: String, code: String, message: String) {
        sendJSON(JSONObject().apply {
            put("type", "relay:response:error")
            put("requestId", requestId)
            put("error", JSONObject().apply {
                put("code", code)
                put("message", message)
            })
        })
    }

    private fun sendVaultOffer(appOrigin: String) {
        val w = wallet ?: return
        val providerIds = w.credentials.value.map { it.providerId }.distinct()
        scope.launch {
            val result = w.createVaultAppSession(appOrigin, providerIds)
            if (result == null) {
                sendJSON(JSONObject().apply {
                    put("type", "relay:vault:offer:failed")
                    put("reason", when {
                        !w.cloudVaultEnabled.value -> "vault_disabled"
                        w.cloudVaultTokenExpired.value -> "token_expired"
                        else -> "session_create_failed"
                    })
                })
                return@launch
            }
            sendJSON(JSONObject().apply {
                put("type", "relay:vault:offer")
                put("vaultUrl", result.vaultUrl)
                put("appSessionToken", result.appSessionToken)
                put("providers", result.providers)
            })
        }
    }

    private fun sendJSON(obj: JSONObject) {
        webSocket?.send(obj.toString())
    }

    companion object {
        private val STREAM_USAGE_PROVIDERS = setOf("openai", "azure-openai", "together", "deepseek")

        /** Process-wide singleton so MainActivity can reach the pair socket
         *  on foreground to reconnect — without this, recipients see the
         *  phone as offline forever after the app is backgrounded once. */
        @Volatile private var sharedInstance: RelayPairService? = null
        fun shared(appContext: android.content.Context): RelayPairService {
            val existing = sharedInstance
            if (existing != null) return existing
            return synchronized(this) {
                val again = sharedInstance
                if (again != null) return@synchronized again
                val created = RelayPairService(appContext.applicationContext)
                sharedInstance = created
                created
            }
        }

        /**
         * Compose a human-readable, actionable error message for the
         * `NO_CREDENTIAL` failure mode. Mirrors `RelayPairService.swift`'s
         * `buildNoCredentialMessage`. Three branches by data shape:
         *
         *   1. Group binds to a provider != requested → user has a routing
         *      rule but the destination has no key. Tell them to add the
         *      destination key or rebind the group.
         *   2. Group binds to the requested provider (or no group) and
         *      user has *some* credentials → tell them to move the app to
         *      a group bound to one of their existing keys, or add a key.
         *   3. Wallet is empty → tell them to add any key.
         */
        fun buildNoCredentialMessage(
            requestedProviderId: String,
            userCredentialProviderIds: List<String>,
            giftedProviderIds: List<String> = emptyList(),
            group: com.byoky.app.data.Group?,
        ): String {
            val req = requestedProviderId
            // An empty providerId means the sentinel default group — no
            // routing, so treat as if no group were set.
            val groupBinding = group?.providerId?.takeIf { it.isNotEmpty() }
            // Case 1: routing rule points at a provider with no credential.
            if (groupBinding != null && groupBinding != req) {
                return "No $groupBinding API key found. Add a $groupBinding key to your wallet, or assign this app to a provider you already have a key for."
            }
            // Case 2a: gift exists for requested provider but fell through —
            // this is a bug on our side (expired / exhausted / state sync).
            // Surface it so it's diagnosable rather than hidden behind a
            // generic "no key" message.
            if (req in giftedProviderIds) {
                return "Gift for $req is present but not being used. Try backgrounding and foregrounding the app, or re-redeem the gift."
            }
            // Case 2: user has other credentials but not for the requested provider.
            if (userCredentialProviderIds.isNotEmpty()) {
                val list = userCredentialProviderIds.joinToString(", ")
                var base = "No $req API key found. You have keys for: $list."
                if (giftedProviderIds.isNotEmpty()) {
                    base += " Gifts: ${giftedProviderIds.joinToString(", ")}."
                }
                base += " Add a $req key, or assign this app to one of those providers."
                return base
            }
            // Case 2b: only gifts, no own credentials.
            if (giftedProviderIds.isNotEmpty()) {
                return "No $req API key found. Your gifts cover: ${giftedProviderIds.joinToString(", ")}. Redeem or add a $req key."
            }
            // Case 3: wallet is empty.
            return "No API keys in your wallet. Add a key for any provider to get started."
        }
    }
}
