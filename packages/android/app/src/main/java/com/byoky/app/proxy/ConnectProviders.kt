package com.byoky.app.proxy

import com.byoky.app.data.AuthMethod
import com.byoky.app.data.Credential
import org.json.JSONArray
import org.json.JSONObject

/**
 * The `providers` map of a connect response, as the extension builds it
 * (createSession in background.ts): one entry per provider the app asked
 * for, available when routing can serve it (direct key, group pin,
 * cross-family translation, same-family swap or auto-routing) and
 * `{available:false}` otherwise, so `session.providers[id].available` works
 * for every requested id. An app that names no providers gets every
 * provider the wallet holds a key for, as before. Pure, unit-tested.
 */
object ConnectProviders {

    data class Entry(val providerId: String, val available: Boolean, val authMethod: String)

    data class Result(
        val entries: List<Entry>,
        /** The providers recorded on the session (shown in the Connected tab). */
        val sessionProviders: List<String>,
    )

    /**
     * [requested]: the provider ids of the connect request, in order.
     * [canServe]: the key a request for that provider would use, or null.
     */
    fun build(requested: List<String>, credentials: List<Credential>, canServe: (String) -> Credential?): Result {
        if (requested.isEmpty()) {
            val held = credentials.distinctBy { it.providerId }
            return Result(
                entries = held.map { Entry(it.providerId, true, authMethodOf(it)) },
                sessionProviders = held.map { it.providerId },
            )
        }
        val entries = requested.distinct().map { id ->
            val credential = canServe(id)
            Entry(id, credential != null, credential?.let(::authMethodOf) ?: "api_key")
        }
        return Result(entries, entries.filter { it.available }.map { it.providerId })
    }

    /**
     * Provider ids from a connect request's `providers` array: entries are
     * `{id, required?}` objects (the SDK) or bare strings. Anything else is
     * skipped, as are ids that aren't plausible provider ids.
     */
    fun requestedIds(providers: JSONArray?): List<String> {
        if (providers == null) return emptyList()
        return (0 until providers.length()).mapNotNull { i ->
            val id = when (val entry = providers.opt(i)) {
                is String -> entry
                is JSONObject -> entry.opt("id") as? String
                else -> null
            }
            id?.takeIf { PROVIDER_ID.matches(it) }
        }
    }

    private fun authMethodOf(credential: Credential) =
        if (credential.authMethod == AuthMethod.OAUTH) "oauth" else "api_key"

    private val PROVIDER_ID = Regex("^[a-z0-9_]{1,64}$")
}
