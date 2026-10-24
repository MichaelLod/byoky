package com.byoky.app.data

import com.byoky.app.crypto.CryptoService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/** Hostile or sloppy `.byoky` files (security review items 2 and 4). */
class BackupSanitizeTest {

    private val now = 1_800_000_000_000L

    private fun entry(
        providerId: String,
        baseUrl: String? = null,
        createdAt: Long = 1_700_000_000_000L,
        authMethod: String = "api_key",
    ) = BackupFile.FileEntry(providerId, providerId, authMethod, createdAt, baseUrl, "x", hasRefreshToken = false, expiresAt = null)

    @Test
    fun fixedHostProvidersNeverKeepABaseUrl() {
        val safe = BackupFile.sanitize(entry("openai", baseUrl = "https://evil.example"), now)!!
        assertNull(safe.baseUrl)
        assertNull(BackupFile.sanitize(entry("anthropic", baseUrl = "https://evil.example/v1"), now)!!.baseUrl)
    }

    @Test
    fun azureNeedsAnHttpsBaseUrl() {
        assertEquals("https://res.openai.azure.com", BackupFile.sanitize(entry("azure_openai", "https://res.openai.azure.com/"), now)!!.baseUrl)
        assertNull("missing", BackupFile.sanitize(entry("azure_openai", null), now))
        assertNull("http", BackupFile.sanitize(entry("azure_openai", "http://res.openai.azure.com"), now))
        assertNull("userinfo", BackupFile.sanitize(entry("azure_openai", "https://u:p@res.openai.azure.com"), now))
        assertNull("not a url", BackupFile.sanitize(entry("azure_openai", "javascript:alert(1)"), now))
    }

    @Test
    fun localServersAllowHttpOnlyToLoopback() {
        assertEquals("http://localhost:11434", BackupFile.sanitize(entry("ollama", "http://localhost:11434"), now)!!.baseUrl)
        assertEquals("http://127.0.0.1:1234", BackupFile.sanitize(entry("lm_studio", "http://127.0.0.1:1234/"), now)!!.baseUrl)
        assertEquals("https://ollama.home.example", BackupFile.sanitize(entry("ollama", "https://ollama.home.example"), now)!!.baseUrl)
        assertNull(BackupFile.sanitize(entry("ollama", "http://192.168.1.20:11434"), now))
        assertNull(BackupFile.sanitize(entry("lm_studio", "http://evil.example:1234"), now))
        assertNull(BackupFile.sanitize(entry("ollama", null), now))
    }

    @Test
    fun createdAtIsNeverInTheFuture() {
        assertEquals(now, BackupFile.sanitize(entry("openai", createdAt = now + 10_000_000), now)!!.createdAt)
        // Missing / non-positive timestamps become "now", like the extension.
        assertEquals(now, BackupFile.sanitize(entry("openai", createdAt = -5), now)!!.createdAt)
        assertEquals(now, BackupFile.sanitize(entry("openai", createdAt = 0), now)!!.createdAt)
        assertEquals(1_700_000_000_000L, BackupFile.sanitize(entry("openai"), now)!!.createdAt)
    }

    @Test
    fun deeplyNestedJsonIsRejectedWithoutStackOverflow() {
        val password = "Hostile-Passw0rd!"
        val depth = 100_000
        val bomb = """{"version":2,"credentials":""" + "[".repeat(depth) + "]".repeat(depth) + "}"
        try {
            BackupFile.decode(CryptoService.encrypt(bomb, password), password)
            fail("expected rejection")
        } catch (e: BackupFile.BackupException) {
            assertEquals(BackupFile.INVALID_FORMAT, e.message)
        }
    }

    @Test
    fun nestingCheckIgnoresBracketsInsideStrings() {
        // Escaped quote inside a string: the brackets after it are still string content.
        assertFalse(BackupFile.nestingExceeds("""{"label":"[[[[[[[[[[[[[[[[[[[[","x":"\"[[["}""", 3))
        // Escaped backslash, then the string really ends: these brackets count.
        assertTrue(BackupFile.nestingExceeds("""{"x":"\\"[[[1]]]}""", 3))
        assertTrue(BackupFile.nestingExceeds("[[[[", 3))
        assertFalse(BackupFile.nestingExceeds("[[[]]]", 3))
    }

    @Test
    fun moreThan500EntriesIsRejected() {
        val password = "Hostile-Passw0rd!"
        val creds = JSONArray()
        repeat(BackupFile.MAX_ENTRIES + 1) { i ->
            creds.put(JSONObject().put("providerId", "openai").put("authMethod", "api_key").put("label", "k$i").put("encryptedKey", "x"))
        }
        val payload = JSONObject().put("version", 2).put("credentials", creds).toString()
        try {
            BackupFile.decode(CryptoService.encrypt(payload, password), password)
            fail("expected rejection")
        } catch (e: BackupFile.BackupException) {
            assertTrue(e.message!!.contains("500"))
        }
    }

    @Test
    fun overlongLabelsAreTruncated() {
        val password = "Hostile-Passw0rd!"
        val payload = JSONObject().put("version", 2).put(
            "credentials",
            JSONArray().put(JSONObject().put("providerId", "openai").put("authMethod", "api_key").put("label", "L".repeat(5_000)).put("encryptedKey", "x")),
        ).toString()
        val entries = BackupFile.decode(CryptoService.encrypt(payload, password), password)
        assertEquals(200, entries.single().label.length)
    }

    @Test
    fun blankLabelsFallBackToTheProviderName() {
        val password = "Hostile-Passw0rd!"
        val payload = JSONObject().put("version", 2).put(
            "credentials",
            JSONArray().put(JSONObject().put("providerId", "openai").put("authMethod", "api_key").put("label", "   ").put("encryptedKey", "x")),
        ).toString()
        assertEquals("OpenAI", BackupFile.decode(CryptoService.encrypt(payload, password), password).single().label)
    }

    @Test
    fun exportWritesBaseUrlOnlyForProvidersWithoutAFixedHost() = runBlocking {
        val password = "Export-Passw0rd!"
        val file = BackupFile.encode(
            listOf(
                BackupFile.PlainCredential("openai", "o", AuthMethod.API_KEY, 1, "https://stale.example", ""),
                BackupFile.PlainCredential("ollama", "l", AuthMethod.API_KEY, 1, "http://localhost:11434/", ""),
            ),
            password,
        )
        val creds = JSONObject(CryptoService.decrypt(file, password)).getJSONArray("credentials")
        assertFalse(creds.getJSONObject(0).has("baseUrl"))
        assertFalse(creds.getJSONObject(0).has("lastUsedAt"))
        assertEquals("http://localhost:11434", creds.getJSONObject(1).getString("baseUrl"))
    }

    @Test
    fun decryptingKeysStopsWhenCancelled() = runBlocking {
        val password = "Cancel-Passw0rd!"
        val secret = CryptoService.encrypt("sk-test", password)
        val entries = List(200) { BackupFile.FileEntry("openai", "k$it", "api_key", 0, null, secret, false, null) }
        val done = AtomicInteger(0)
        val job = launch(Dispatchers.Default) {
            BackupFile.decryptSecrets(entries, password) { done.incrementAndGet() }
        }
        delay(300)
        job.cancelAndJoin()
        val afterCancel = done.get()
        delay(1_500)
        // Work already in flight may finish, but nothing new starts.
        assertTrue("decrypted $afterCancel of 200 before cancel", afterCancel < 200)
        assertTrue("kept decrypting after cancel", done.get() - afterCancel <= Runtime.getRuntime().availableProcessors())
    }
}
