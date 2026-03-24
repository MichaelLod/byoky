package com.byoky.app.data

import android.util.Base64
import org.json.JSONObject
import java.security.SecureRandom
import java.util.UUID

data class Gift(
    val id: String = UUID.randomUUID().toString(),
    val credentialId: String,
    val providerId: String,
    val label: String,
    val authToken: String,
    val maxTokens: Int,
    val usedTokens: Int = 0,
    val expiresAt: Long,
    val createdAt: Long = System.currentTimeMillis(),
    val active: Boolean = true,
    val relayUrl: String,
)

data class GiftLink(
    val v: Int,
    val id: String,
    val p: String,
    val n: String,
    val s: String,
    val t: String,
    val m: Int,
    val e: Long,
    val r: String,
)

data class GiftedCredential(
    val id: String = UUID.randomUUID().toString(),
    val giftId: String,
    val providerId: String,
    val providerName: String,
    val senderLabel: String,
    val authToken: String,
    val maxTokens: Int,
    val usedTokens: Int = 0,
    val expiresAt: Long,
    val relayUrl: String,
    val createdAt: Long = System.currentTimeMillis(),
)

fun encodeGiftLink(link: GiftLink): String {
    val json = JSONObject().apply {
        put("v", link.v)
        put("id", link.id)
        put("p", link.p)
        put("n", link.n)
        put("s", link.s)
        put("t", link.t)
        put("m", link.m)
        put("e", link.e)
        put("r", link.r)
    }
    return Base64.encodeToString(
        json.toString().toByteArray(Charsets.UTF_8),
        Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
    )
}

fun decodeGiftLink(encoded: String): GiftLink? {
    return try {
        val json = String(
            Base64.decode(encoded, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING),
            Charsets.UTF_8,
        )
        val obj = JSONObject(json)
        GiftLink(
            v = obj.getInt("v"),
            id = obj.getString("id"),
            p = obj.getString("p"),
            n = obj.getString("n"),
            s = obj.getString("s"),
            t = obj.getString("t"),
            m = obj.getInt("m"),
            e = obj.getLong("e"),
            r = obj.getString("r"),
        )
    } catch (_: Exception) {
        null
    }
}

fun giftLinkToUrl(encoded: String): String = "byoky://gift/$encoded"

fun validateGiftLink(link: GiftLink): Pair<Boolean, String?> {
    if (link.v != 1) return Pair(false, "Unsupported gift version")
    if (link.id.isBlank()) return Pair(false, "Missing gift ID")
    if (link.p.isBlank()) return Pair(false, "Missing provider")
    if (link.t.isBlank()) return Pair(false, "Missing auth token")
    if (link.m <= 0) return Pair(false, "Invalid token budget")
    if (link.e <= System.currentTimeMillis()) return Pair(false, "Gift has expired")
    if (!link.r.startsWith("wss://")) return Pair(false, "Invalid relay URL")
    return Pair(true, null)
}

fun isGiftExpired(expiresAt: Long): Boolean = System.currentTimeMillis() > expiresAt

fun giftBudgetRemaining(usedTokens: Int, maxTokens: Int): Int = maxOf(0, maxTokens - usedTokens)

fun giftBudgetPercent(usedTokens: Int, maxTokens: Int): Int {
    if (maxTokens <= 0) return 0
    return ((usedTokens.toLong() * 100) / maxTokens).toInt().coerceIn(0, 100)
}

fun createGiftLink(gift: Gift): Pair<String, GiftLink> {
    val provider = Provider.find(gift.providerId)
    val link = GiftLink(
        v = 1,
        id = gift.id,
        p = gift.providerId,
        n = provider?.name ?: gift.providerId,
        s = gift.label,
        t = gift.authToken,
        m = gift.maxTokens,
        e = gift.expiresAt,
        r = gift.relayUrl,
    )
    val encoded = encodeGiftLink(link)
    return Pair(encoded, link)
}

fun formatTokens(n: Int): String = when {
    n >= 1_000_000 -> String.format("%.1fM", n / 1_000_000.0)
    n >= 1_000 -> "${n / 1_000}K"
    else -> "$n"
}

fun generateAuthToken(): String {
    val bytes = ByteArray(32)
    SecureRandom().nextBytes(bytes)
    return bytes.joinToString("") { "%02x".format(it) }
}
