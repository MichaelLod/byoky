package com.byoky.app

import com.byoky.app.data.RequestLog
import com.byoky.app.data.Session
import com.byoky.app.data.TokenAllowance
import com.byoky.app.data.UsageLedger
import com.byoky.app.data.WalletStore
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Store screenshots only. run.sh copies this into a scratch copy of
 * packages/android (never into the repo) and calls it from MainActivity in
 * debug builds when the launch intent carries `byoky_store_seed`. All data is
 * fake: placeholder keys, byoky.com / example.com origins, no network calls.
 */
object MarketingSeed {
    const val PASSWORD = "Muninn-Demo-2026!"

    suspend fun run(wallet: WalletStore) {
        wallet.createPassword(PASSWORD)
        wallet.addCredential("anthropic", "Anthropic", "sk-ant-api03-PLACEHOLDER-not-a-real-key-000000000000004f2c")
        wallet.addCredential("openai", "OpenAI", "sk-proj-PLACEHOLDER-not-a-real-key-0000000000000000a91e")
        wallet.addCredential("gemini", "Google Gemini", "AIzaPLACEHOLDER-not-a-real-key-00000007bd3")
        val openai = wallet.credentials.value.first { it.providerId == "openai" }

        val demo = "https://byoky.com"
        val chat = "https://chat.example.com"
        val now = System.currentTimeMillis()
        val minute = 60_000L

        // Notes was disconnected earlier, so opening it asks to reconnect.
        wallet.revokeSession(wallet.upsertSession("https://notes.example.com", listOf("anthropic")))
        wallet.upsertSession(demo, listOf("anthropic", "openai"))
        wallet.upsertSession(chat, listOf("anthropic"))
        // Believable "connected … ago" times, then save them through upsertSession.
        @Suppress("UNCHECKED_CAST")
        val sessions = field<MutableStateFlow<List<Session>>>(wallet, "_sessions")
        sessions.value = sessions.value.map {
            it.copy(createdAt = now - (if (it.appOrigin == demo) 42 else 180) * minute)
        }
        sessions.value.forEach { wallet.upsertSession(it.appOrigin, it.providers) }

        // Routing: chat.example.com asks for Anthropic, its group sends it to OpenAI.
        val group = wallet.createGroup("Fast", "openai", openai.id, "gpt-4o-mini")
        wallet.setAppGroup(chat, group.id)

        data class Row(val origin: String, val provider: String, val model: String, val input: Int, val output: Int, val ago: Long, val actual: String? = null, val actualModel: String? = null)
        val rows = mutableListOf<Row>()
        listOf(2140 to 512, 1870 to 430, 3320 to 690, 1210 to 288, 2650 to 604, 1980 to 455, 2410 to 571, 1630 to 377, 2890 to 640, 1450 to 330,
            2230 to 498, 3010 to 702, 1760 to 401, 2570 to 589, 1340 to 296, 2060 to 470, 2780 to 615, 1590 to 352, 2320 to 520, 1910 to 433, 2470 to 560)
            .forEachIndexed { i, (a, b) -> rows += Row(demo, "anthropic", "claude-sonnet-4-5", a, b, i * 410L + 4) }
        listOf(1320 to 310, 980 to 240, 1540 to 362, 1110 to 255, 1720 to 398, 890 to 204, 1430 to 330, 1260 to 287)
            .forEachIndexed { i, (a, b) -> rows += Row(demo, "openai", "gpt-4o-mini", a, b, i * 620L + 11) }
        listOf(1840 to 420, 1210 to 296, 2260 to 514, 1580 to 361, 1990 to 447, 1370 to 318)
            .forEachIndexed { i, (a, b) -> rows += Row(chat, "anthropic", "claude-sonnet-4-5", a, b, i * 530L + 7, "openai", "gpt-4o-mini") }
        listOf(2210 to 380, 1650 to 290, 1980 to 341, 1430 to 260)
            .forEachIndexed { i, (a, b) -> rows += Row(demo, "gemini", "gemini-2.5-flash", a, b, i * 900L + 20) }
        rows.sortBy { it.ago }
        val urls = mapOf(
            "anthropic" to "https://api.anthropic.com/v1/messages",
            "openai" to "https://api.openai.com/v1/chat/completions",
            "gemini" to "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        )
        val logs = field<MutableStateFlow<List<RequestLog>>>(wallet, "_requestLogs")
        logs.value = rows.map {
            RequestLog(appOrigin = it.origin, providerId = it.provider, method = "POST", url = urls.getValue(it.provider),
                statusCode = 200, timestamp = now - it.ago * minute, inputTokens = it.input, outputTokens = it.output,
                model = it.model, actualProviderId = it.actual, actualModel = it.actualModel)
        }
        // Count the same requests against the apps' allowances.
        for (r in rows) {
            val admission = wallet.admitRequest(r.origin, r.provider, null)
            if (admission is UsageLedger.Admission.Allowed) {
                wallet.settleUsage(admission.reservation, UsageLedger.Usage(1, r.input.toLong(), r.output.toLong()))
            }
        }
        // One more through the real logging path, which also saves the log.
        wallet.logRequest(demo, "anthropic", "POST", urls.getValue("anthropic"), 200,
            """{"model":"claude-sonnet-4-5","max_tokens":1024,"messages":[]}""".toByteArray(),
            UsageLedger.Usage(1, 1720, 388))

        wallet.setAllowance(TokenAllowance(demo, totalLimit = 100_000, providerLimits = mapOf("anthropic" to 80_000)))

        wallet.addAppByUrl("chat.example.com", "Chat")
        wallet.addAppByUrl("notes.example.com", "Notes")
        wallet.addAppByUrl("review.example.com", "Review")
    }

    @Suppress("UNCHECKED_CAST")
    private fun <T> field(target: Any, name: String): T {
        val f = target.javaClass.getDeclaredField(name)
        f.isAccessible = true
        return f.get(target) as T
    }
}
