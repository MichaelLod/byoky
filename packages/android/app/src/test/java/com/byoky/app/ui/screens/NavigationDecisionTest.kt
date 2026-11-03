package com.byoky.app.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Test

/** The in-wallet browser's navigation policy (F049), as on iOS. */
class NavigationDecisionTest {

    private val app = "https://chat.example.com"

    private fun decide(
        url: String,
        mainFrame: Boolean = true,
        redirect: Boolean = false,
        gesture: Boolean = false,
    ): NavigationDecision {
        val uri = java.net.URI(url)
        val origin = uri.host?.let { "${uri.scheme}://$it" + if (uri.port != -1) ":${uri.port}" else "" }
        return navigationDecision(uri.scheme, origin, mainFrame, redirect, gesture, app)
    }

    @Test
    fun theAppsOwnOriginLoads() {
        assertEquals(NavigationDecision.Allow, decide("https://chat.example.com/c/1"))
        assertEquals(NavigationDecision.Allow, decide("https://chat.example.com/login", redirect = true))
        assertEquals(NavigationDecision.Allow, decide("https://chat.example.com/", gesture = true))
    }

    @Test
    fun aTappedLinkToAnotherSiteOpensInTheBrowser() {
        assertEquals(NavigationDecision.OpenExternally, decide("https://docs.example.org/keys", gesture = true))
        assertEquals(NavigationDecision.OpenExternally, decide("http://example.org/", gesture = true))
    }

    /** example.com → www.example.com, or a tapped /login the server sends to an identity provider. */
    @Test
    fun aRedirectToAnotherSiteIsBlockedWithANotice() {
        assertEquals(NavigationDecision.BlockedRedirect, decide("https://www.chat.example.com/", redirect = true))
        assertEquals(NavigationDecision.BlockedRedirect, decide("https://accounts.example.org/auth", redirect = true, gesture = true))
    }

    /** location.href = … without a tap. */
    @Test
    fun aScriptNavigationWithoutATapIsBlockedWithANotice() {
        assertEquals(NavigationDecision.BlockedRedirect, decide("https://tracker.example.net/"))
    }

    @Test
    fun otherSchemesNeverLoad() {
        for (url in listOf("intent://scan#Intent;scheme=zxing;end", "javascript:alert(1)", "file:///etc/passwd", "byoky-evil://x")) {
            assertEquals(url, NavigationDecision.Cancel, decide(url, gesture = true))
        }
        // The app's host over plain http or another port is another origin.
        assertEquals(NavigationDecision.BlockedRedirect, decide("http://chat.example.com/"))
        assertEquals(NavigationDecision.BlockedRedirect, decide("https://chat.example.com:8443/"))
    }

    @Test
    fun subframesAreLeftToThePage() {
        assertEquals(NavigationDecision.Allow, decide("https://js.stripe.com/v3/", mainFrame = false))
    }
}
