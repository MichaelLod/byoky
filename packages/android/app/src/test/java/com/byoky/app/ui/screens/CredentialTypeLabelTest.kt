package com.byoky.app.ui.screens

import com.byoky.app.data.AuthMethod
import org.junit.Assert.assertEquals
import org.junit.Test

/** What a wallet card says a credential is. */
class CredentialTypeLabelTest {

    @Test
    fun aLocalServerAddedWithoutAKeyHasNoAuth() {
        assertEquals("No auth", credentialTypeLabel("ollama", AuthMethod.API_KEY, hasKey = false))
        assertEquals("No auth", credentialTypeLabel("lm_studio", AuthMethod.API_KEY, hasKey = false))
    }

    @Test
    fun aLocalServerWithAKeyHasAnApiKey() {
        assertEquals("API Key", credentialTypeLabel("ollama", AuthMethod.API_KEY, hasKey = true))
    }

    @Test
    fun cloudKeysAndSetupTokensKeepTheirNames() {
        assertEquals("API Key", credentialTypeLabel("openai", AuthMethod.API_KEY, hasKey = true))
        // A cloud key always has a key; a missing one is not "no auth".
        assertEquals("API Key", credentialTypeLabel("openai", AuthMethod.API_KEY, hasKey = false))
        assertEquals("Setup Token", credentialTypeLabel("anthropic", AuthMethod.OAUTH, hasKey = true))
    }
}
