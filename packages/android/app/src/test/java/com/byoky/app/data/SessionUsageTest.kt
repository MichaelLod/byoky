package com.byoky.app.data

import org.junit.Assert.assertEquals
import org.junit.Test

/** getUsage() reports this session only, like the extension and iOS. */
class SessionUsageTest {

    private fun log(sessionId: String?, provider: String, status: Int, input: Int?, output: Int?, origin: String = "https://app.example") =
        RequestLog(appOrigin = origin, providerId = provider, method = "POST", url = "u", statusCode = status,
            inputTokens = input, outputTokens = output, sessionId = sessionId)

    @Test
    fun onlyThisSessionsSuccessfulRequestsCount() {
        val logs = listOf(
            log("s2", "openai", 200, 10, 5),
            log("s2", "anthropic", 200, 3, 2),
            log("s2", "openai", 499, 100, 4000),   // cancelled
            log("s2", "openai", 429, 1, 1),        // failed
            log("s1", "openai", 200, 1000, 1000),  // an earlier session
            log(null, "openai", 200, 7, 7),        // logged before sessions were recorded
            log("s9", "openai", 200, 9, 9, origin = "https://other.example"),
            log("s2", "gemini", 200, null, null),  // no usage reported
        )

        val usage = SessionUsage.from("s2", logs)

        assertEquals(SessionUsage.Totals(3, 13, 7), usage.total)
        assertEquals(
            mapOf(
                "openai" to SessionUsage.Totals(1, 10, 5),
                "anthropic" to SessionUsage.Totals(1, 3, 2),
                "gemini" to SessionUsage.Totals(1, 0, 0),
            ),
            usage.byProvider,
        )
    }

    @Test
    fun aNewSessionStartsAtZero() {
        val usage = SessionUsage.from("fresh", listOf(log("old", "openai", 200, 1000, 1000)))
        assertEquals(SessionUsage.Totals(), usage.total)
        assertEquals(emptyMap<String, SessionUsage.Totals>(), usage.byProvider)
    }
}
