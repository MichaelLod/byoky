package com.byoky.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/** Changing the server URL of a key already in the wallet (WalletStore.updateCredentialEndpoint). */
class CredentialEndpointTest {

    private val ollama = Credential(id = "ollama-1", providerId = "ollama", label = "Ollama", baseUrl = "http://localhost:11434")
    private val azureWithout = Credential(id = "azure-1", providerId = "azure_openai", label = "Azure", baseUrl = null)
    private val openai = Credential(id = "openai-1", providerId = "openai", label = "OpenAI")
    private val all = listOf(ollama, azureWithout, openai)

    @Test
    fun setsANormalizedUrlAndKeepsTheId() {
        val updated = withCredentialEndpoint(all, "ollama-1", " http://127.0.0.1:8080/ ")
        assertEquals("http://127.0.0.1:8080", updated[0].baseUrl)
        assertEquals("ollama-1", updated[0].id)
        assertEquals(listOf(azureWithout, openai), updated.drop(1))
    }

    @Test
    fun addsAMissingAzureEndpoint() {
        val updated = withCredentialEndpoint(all, "azure-1", "https://contoso.openai.azure.com")
        assertEquals("https://contoso.openai.azure.com", updated[1].baseUrl)
    }

    @Test
    fun rejectsWhatAddingAKeyRejects() {
        // Cleartext off the phone, a fixed-host provider, an unknown id.
        assertThrows(IllegalArgumentException::class.java) {
            withCredentialEndpoint(all, "ollama-1", "http://192.168.1.20:11434")
        }
        assertThrows(IllegalArgumentException::class.java) {
            withCredentialEndpoint(all, "azure-1", "http://contoso.openai.azure.com")
        }
        assertThrows(IllegalArgumentException::class.java) {
            withCredentialEndpoint(all, "openai-1", "https://evil.example")
        }
        assertThrows(IllegalArgumentException::class.java) {
            withCredentialEndpoint(all, "missing", "https://contoso.openai.azure.com")
        }
    }
}
