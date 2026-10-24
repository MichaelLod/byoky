package com.byoky.app.data

import org.junit.Assert.assertEquals
import org.junit.Test

class AppOpenGateTest {

    private fun app(url: String, name: String = "Demo") = InstalledApp(id = "id-$url", name = name, url = url)

    @Test
    fun neverRevokedAppOpensRightAway() {
        assertEquals(AppOpenGate.Decision.Open, AppOpenGate.decide(app("https://byoky.com/demo"), emptySet()))
    }

    @Test
    fun revokedOriginAsksToReconnect() {
        val demo = app("https://byoky.com/demo", name = "Byoky Demo")
        val decision = AppOpenGate.decide(demo, setOf("https://byoky.com"))
        assertEquals(AppOpenGate.Decision.ConfirmReconnect(demo, host = "byoky.com"), decision)
    }

    @Test
    fun revokeCoversEveryAppOnThatOrigin() {
        val chat = app("https://byoky.com/chat")
        assertEquals(
            AppOpenGate.Decision.ConfirmReconnect(chat, host = "byoky.com"),
            AppOpenGate.decide(chat, setOf("https://byoky.com")),
        )
    }

    @Test
    fun otherOriginsAreNotAffected() {
        val revoked = setOf("https://byoky.com")
        assertEquals(AppOpenGate.Decision.Open, AppOpenGate.decide(app("https://app.example.com/"), revoked))
        // A subdomain is a different origin.
        assertEquals(AppOpenGate.Decision.Open, AppOpenGate.decide(app("https://chat.byoky.com/"), revoked))
    }

    @Test
    fun hostKeepsANonDefaultPort() {
        val a = app("https://app.example.com:8443/x")
        assertEquals(
            AppOpenGate.Decision.ConfirmReconnect(a, host = "app.example.com:8443"),
            AppOpenGate.decide(a, setOf("https://app.example.com:8443")),
        )
    }
}
