package com.byoky.app.data

import org.json.JSONArray
import org.json.JSONObject

/**
 * Running token usage per app origin and provider, the numbers token
 * allowances are enforced against. Unlike the request log (capped at 500
 * entries for display), nothing ever falls out of it, so an app can't push
 * its expensive requests out of view with cheap ones.
 *
 * Usage is keyed by the provider the app named, which is what the user sets
 * limits on (the extension does the same for routed calls).
 *
 * Every admitted request holds a reservation until it settles, and
 * reservations count as used when the next request is admitted, so a burst
 * of parallel requests can't all start against the same remaining budget.
 * A request is admitted while used + reserved is below the limit; it may
 * overshoot by its own size, as before.
 *
 * Thread-safe. Persistence is the caller's: [toJson] / [fromJson].
 */
class UsageLedger {

    data class Usage(val requests: Long = 0, val inputTokens: Long = 0, val outputTokens: Long = 0) {
        val tokens: Long get() = inputTokens + outputTokens
        operator fun plus(other: Usage) = Usage(
            requests + other.requests,
            inputTokens + other.inputTokens,
            outputTokens + other.outputTokens,
        )
    }

    class Reservation internal constructor(
        val origin: String,
        val providerId: String,
        internal val tokens: Long,
        internal val epoch: Long,
    )

    sealed class Admission {
        data class Allowed(val reservation: Reservation) : Admission()
        data class Denied(val reason: String) : Admission()
    }

    private val lock = Any()
    /** Bumped by [clear]; reservations from before it settle to nothing. */
    private var epoch = 0L
    private val used = mutableMapOf<String, MutableMap<String, Usage>>()
    private val reserved = mutableMapOf<String, MutableMap<String, Long>>()

    /**
     * Admit one request of [origin] to [providerId] under [allowance], or
     * deny it. [estimate] (tokens to hold while it runs) is only evaluated
     * when there is an allowance to enforce.
     */
    fun admit(allowance: TokenAllowance?, origin: String, providerId: String, estimate: () -> Long): Admission {
        val hold = if (allowance == null) 0L else estimate().coerceAtLeast(0)
        synchronized(lock) {
            if (allowance != null) {
                val usedByProvider = used[origin].orEmpty()
                val heldByProvider = reserved[origin].orEmpty()
                val total = usedByProvider.values.sumOf { it.tokens } + heldByProvider.values.sum()
                if (allowance.totalLimit != null && total >= allowance.totalLimit) {
                    return Admission.Denied("Token allowance exceeded for ${allowance.origin}")
                }
                val providerLimit = allowance.providerLimits?.get(providerId)
                val forProvider = (usedByProvider[providerId]?.tokens ?: 0) + (heldByProvider[providerId] ?: 0)
                if (providerLimit != null && forProvider >= providerLimit) {
                    return Admission.Denied("Token allowance for $providerId exceeded")
                }
            }
            if (hold > 0) {
                val held = reserved.getOrPut(origin) { mutableMapOf() }
                held[providerId] = (held[providerId] ?: 0) + hold
            }
            return Admission.Allowed(Reservation(origin, providerId, hold, epoch))
        }
    }

    /**
     * Release [reservation] and add what the request actually [counted]
     * (null: nothing, e.g. it never reached the provider). Returns whether
     * the totals changed. Call it exactly once per admitted request.
     */
    fun settle(reservation: Reservation, counted: Usage?): Boolean = synchronized(lock) {
        // Admitted before the totals were cleared (wallet reset): drop it.
        if (reservation.epoch != epoch) return@synchronized false
        if (reservation.tokens > 0) {
            val held = reserved[reservation.origin]
            if (held != null) {
                val left = (held[reservation.providerId] ?: 0) - reservation.tokens
                if (left > 0) held[reservation.providerId] = left else held.remove(reservation.providerId)
                if (held.isEmpty()) reserved.remove(reservation.origin)
            }
        }
        if (counted == null) return@synchronized false
        val byProvider = used.getOrPut(reservation.origin) { mutableMapOf() }
        byProvider[reservation.providerId] = (byProvider[reservation.providerId] ?: Usage()) + counted
        true
    }

    /** Everything [origin] has used, all providers together. */
    fun total(origin: String): Usage = synchronized(lock) {
        used[origin].orEmpty().values.fold(Usage()) { acc, u -> acc + u }
    }

    fun byProvider(origin: String): Map<String, Usage> = synchronized(lock) {
        used[origin].orEmpty().toMap()
    }

    fun clear() = synchronized(lock) {
        used.clear()
        reserved.clear()
        epoch++
    }

    /** Persisted form of the totals (reservations are in-flight state and never saved). */
    fun toJson(): String = synchronized(lock) {
        val root = JSONObject()
        for ((origin, byProvider) in used) {
            val o = JSONObject()
            for ((providerId, u) in byProvider) {
                o.put(providerId, JSONArray().put(u.requests).put(u.inputTokens).put(u.outputTokens))
            }
            root.put(origin, o)
        }
        JSONObject().put("version", 1).put("usage", root).toString()
    }

    companion object {
        /** Totals from [toJson]; malformed or missing input gives an empty ledger. */
        fun fromJson(json: String?): UsageLedger {
            val ledger = UsageLedger()
            if (json.isNullOrEmpty()) return ledger
            try {
                val root = JSONObject(json).optJSONObject("usage") ?: return ledger
                for (origin in root.keys()) {
                    val o = root.optJSONObject(origin) ?: continue
                    val byProvider = mutableMapOf<String, Usage>()
                    for (providerId in o.keys()) {
                        val a = o.optJSONArray(providerId) ?: continue
                        byProvider[providerId] = Usage(
                            a.optLong(0).coerceAtLeast(0),
                            a.optLong(1).coerceAtLeast(0),
                            a.optLong(2).coerceAtLeast(0),
                        )
                    }
                    if (byProvider.isNotEmpty()) ledger.used[origin] = byProvider
                }
            } catch (_: Exception) {
                ledger.used.clear()
            }
            return ledger
        }

        /** Starting totals for installs that predate the ledger: the successful entries still in the log. */
        fun fromLog(entries: List<RequestLog>): UsageLedger {
            val ledger = UsageLedger()
            for (e in entries) {
                if (e.statusCode >= 400) continue
                val byProvider = ledger.used.getOrPut(e.appOrigin) { mutableMapOf() }
                byProvider[e.providerId] = (byProvider[e.providerId] ?: Usage()) +
                    Usage(1, (e.inputTokens ?: 0).toLong(), (e.outputTokens ?: 0).toLong())
            }
            return ledger
        }

        /**
         * Rough upper bound for a request: about a token per 4 bytes of
         * prompt, plus the largest output limit it names (0 if none). 0 for
         * requests without a JSON body (GETs, binary uploads). The
         * extension's `estimateRequestTokens`.
         */
        fun estimate(body: ByteArray?, binaryBody: Boolean = false): Long {
            if (body == null || body.isEmpty() || binaryBody) return 0
            return promptTokens(body) + maxOutputTokens(body)
        }

        /** About a token per 4 bytes of prompt, rounded up. */
        fun promptTokens(body: ByteArray): Long = (body.size + 3L) / 4

        private fun maxOutputTokens(body: ByteArray): Long {
            if (body.size > MAX_PARSED_BODY) return 0
            return try {
                val parsed = JSONObject(String(body, Charsets.UTF_8))
                val values = listOf(
                    parsed.opt("max_tokens"),
                    parsed.opt("max_completion_tokens"),
                    parsed.opt("max_output_tokens"),
                    parsed.optJSONObject("generationConfig")?.opt("maxOutputTokens"),
                )
                values.maxOf { (it as? Number)?.toLong()?.coerceIn(0, MAX_OUTPUT_HOLD) ?: 0 }
            } catch (_: Exception) {
                0
            }
        }

        private const val MAX_OUTPUT_HOLD = 1_000_000L
        private const val MAX_PARSED_BODY = 10 * 1024 * 1024
    }
}
