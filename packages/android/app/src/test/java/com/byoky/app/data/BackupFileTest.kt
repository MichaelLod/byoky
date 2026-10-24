package com.byoky.app.data

import com.byoky.app.crypto.CryptoService
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * `.byoky` compatibility with the extension and with itself.
 *
 * `backup/extension-v2.byoky` was produced outside this repo by a Node script
 * that imports packages/core/dist/index.js and calls the real core
 * `encrypt()` (WebCrypto, PBKDF2-SHA256 600k, AES-256-GCM) for every secret
 * and for the envelope, in the payload shape of
 * packages/extension/lib/vault-file.ts. It also carries the legacy `gifts` /
 * `giftedCredentials` arrays, a refreshable OAuth login and a retired
 * provider. The password contains a non-ASCII character to pin the UTF-8
 * PBKDF2 input.
 */
class BackupFileTest {

    private val fixturePassword = "Fixture-Pässwort-2026!"

    private fun fixture(): String =
        javaClass.classLoader!!.getResource("backup/extension-v2.byoky")!!.readText()

    @Test
    fun decodesExtensionFixtureWithCoreCompatibleCrypto() = runBlocking {
        val entries = BackupFile.decode(fixture(), fixturePassword)
        assertEquals(7, entries.size)

        val byLabel = entries.associateBy { it.label }
        val anthropic = byLabel.getValue("Anthropic main")
        assertEquals("anthropic", anthropic.providerId)
        assertEquals("api_key", anthropic.authMethod)
        assertEquals(1761000000001L, anthropic.createdAt)
        assertNull(anthropic.baseUrl)

        val lmStudio = byLabel.getValue("LM Studio desk")
        assertEquals("http://192.168.1.20:1234", lmStudio.baseUrl)
        val ollama = byLabel.getValue("Ollama keyless")
        assertEquals("http://10.0.0.5:11434", ollama.baseUrl)
        assertEquals("", ollama.encryptedSecret)
        assertTrue("UTF-8 label survives", byLabel.containsKey("OpenAI · Ünïcode ✓"))

        val secrets = BackupFile.decryptSecrets(entries, fixturePassword)
        assertEquals(
            listOf(
                "sk-ant-api03-FIXTURE-anthropic-key-0001",
                "sk-proj-FIXTURE-openai-key-0002",
                "lm-FIXTURE-key-0003",
                "",
                "sk-ant-oat01-FIXTURE-setup-token-0005",
                "ya29.FIXTURE-access-0006",
                "r8_FIXTURE-0007",
            ),
            secrets,
        )
    }

    @Test
    fun classifiesWhatAndroidCanUse() {
        val entries = BackupFile.decode(fixture(), fixturePassword).associateBy { it.label }
        val now = 1761000200000L
        assertEquals(AuthMethod.API_KEY, BackupFile.sanitize(entries.getValue("Anthropic main"), now)?.authMethod)
        assertEquals(AuthMethod.OAUTH, BackupFile.sanitize(entries.getValue("Claude setup token"), now)?.authMethod)
        // Refreshable OAuth login: Android has no refresh flow.
        assertNull(BackupFile.sanitize(entries.getValue("Gemini OAuth login"), now))
        // Retired provider.
        assertNull(BackupFile.sanitize(entries.getValue("Retired provider"), now))
        // Local servers on LAN addresses over plain http: unsafe, skipped.
        assertNull(BackupFile.sanitize(entries.getValue("LM Studio desk"), now))
        assertNull(BackupFile.sanitize(entries.getValue("Ollama keyless"), now))
    }

    @Test
    fun wrongPasswordIsReportedAsSuch() {
        try {
            BackupFile.decode(fixture(), "not-the-password-123!")
            fail("expected BackupException")
        } catch (e: BackupFile.BackupException) {
            assertEquals(BackupFile.WRONG_PASSWORD, e.message)
        }
    }

    @Test
    fun corruptedFileIsReportedAsWrongPassword() {
        val tampered = fixture().let { it.substring(0, 60) + (if (it[60] == 'A') 'B' else 'A') + it.substring(61) }
        try {
            BackupFile.decode(tampered, fixturePassword)
            fail("expected BackupException")
        } catch (e: BackupFile.BackupException) {
            assertEquals(BackupFile.WRONG_PASSWORD, e.message)
        }
    }

    @Test
    fun toleratesWhitespaceAndLineWrapping() {
        val wrapped = fixture().chunked(76).joinToString("\r\n", postfix = "\n")
        assertEquals(7, BackupFile.decode(wrapped, fixturePassword).size)
    }

    @Test
    fun rejectsPayloadsWithoutVersionOrCredentials() {
        val password = "Another-Passw0rd!"
        for (payload in listOf("{}", """{"version":2}""", """{"credentials":[]}""", """{"version":0,"credentials":[]}""", "[]", "not json")) {
            val file = CryptoService.encrypt(payload, password)
            try {
                BackupFile.decode(file, password)
                fail("expected rejection for $payload")
            } catch (e: BackupFile.BackupException) {
                assertEquals(BackupFile.INVALID_FORMAT, e.message)
            }
        }
    }

    @Test
    fun malformedEntryRejectsTheWholeFile() {
        val password = "Another-Passw0rd!"
        val payload = JSONObject()
            .put("version", 2)
            .put("credentials", JSONArray().put(JSONObject().put("providerId", "openai").put("authMethod", "bearer")))
        try {
            BackupFile.decode(CryptoService.encrypt(payload.toString(), password), password)
            fail("expected rejection")
        } catch (e: BackupFile.BackupException) {
            assertEquals(BackupFile.INVALID_FORMAT, e.message)
        }
    }

    @Test
    fun kotlinExportRoundTripsThroughImport() = runBlocking {
        val password = "Round-Trip-Passw0rd!"
        val original = listOf(
            BackupFile.PlainCredential("anthropic", "Work key", AuthMethod.API_KEY, 1700000000001, null, "sk-ant-api03-RT-1"),
            BackupFile.PlainCredential("anthropic", "Claude Max", AuthMethod.OAUTH, 1700000000002, null, "sk-ant-oat01-RT-2"),
            BackupFile.PlainCredential("ollama", "Home server", AuthMethod.API_KEY, 1700000000003, "http://localhost:11434", ""),
            BackupFile.PlainCredential("openai", "Ünïcode label", AuthMethod.API_KEY, 1700000000004, null, "sk-proj-RT-4 ✓"),
        )
        var steps = 0
        val file = BackupFile.encode(original, password, exportedAt = 1700000009999) { synchronized(this) { steps++ } }
        // 3 non-empty secrets + the envelope.
        assertEquals(4, steps)

        // The envelope is plain core-format JSON.
        val payload = JSONObject(CryptoService.decrypt(file, password))
        assertEquals(2, payload.getInt("version"))
        assertEquals(1700000009999L, payload.getLong("exportedAt"))
        val first = payload.getJSONArray("credentials").getJSONObject(0)
        assertEquals("api_key", first.getString("authMethod"))
        assertTrue(first.has("encryptedKey"))
        val oauth = payload.getJSONArray("credentials").getJSONObject(1)
        assertEquals("oauth", oauth.getString("authMethod"))
        assertTrue(oauth.has("encryptedAccessToken"))
        assertFalse(oauth.has("encryptedKey"))
        assertEquals("", payload.getJSONArray("credentials").getJSONObject(2).getString("encryptedKey"))

        val entries = BackupFile.decode(file, password)
        val secrets = BackupFile.decryptSecrets(entries, password)
        val restored = entries.mapIndexed { i, e ->
            val safe = BackupFile.sanitize(e)!!
            BackupFile.PlainCredential(e.providerId, e.label, safe.authMethod, safe.createdAt, safe.baseUrl, secrets[i])
        }
        assertEquals(original.map { it.copy(id = "") }, restored.map { it.copy(id = "") })

        exportForNodeCheck(file, password, original)
    }

    @Test
    fun mergeSkipsExactDuplicatesAndNeverReusesIds() {
        val existing = listOf(
            BackupFile.PlainCredential("anthropic", "Mine", AuthMethod.API_KEY, 1, null, "sk-ant-same", id = "existing-1"),
            BackupFile.PlainCredential("ollama", "Desk", AuthMethod.API_KEY, 1, "http://10.0.0.1:11434", "", id = "existing-2"),
        )
        val candidates = listOf(
            // Same provider + secret: duplicate even with another label.
            BackupFile.PlainCredential("anthropic", "Theirs", AuthMethod.API_KEY, 2, null, "sk-ant-same", id = "existing-1"),
            // Same secret, different provider: not a duplicate.
            BackupFile.PlainCredential("openai", "Other", AuthMethod.API_KEY, 2, null, "sk-ant-same"),
            // Keyless local server at another address: not a duplicate.
            BackupFile.PlainCredential("ollama", "Laptop", AuthMethod.API_KEY, 2, "http://10.0.0.2:11434", ""),
            // Keyless local server at the same address: duplicate.
            BackupFile.PlainCredential("ollama", "Desk again", AuthMethod.API_KEY, 2, "http://10.0.0.1:11434", ""),
            BackupFile.PlainCredential("gemini", "New", AuthMethod.API_KEY, 2, null, "AIza-new"),
            // Repeated inside the file itself.
            BackupFile.PlainCredential("gemini", "New copy", AuthMethod.API_KEY, 2, null, "AIza-new"),
        )
        val plan = BackupFile.merge(candidates, existing)
        assertEquals(listOf("Other", "Laptop", "New"), plan.toAdd.map { it.label })
        assertEquals(3, plan.duplicates)
        val existingIds = existing.map { it.id }.toSet()
        plan.toAdd.forEach { assertFalse(it.id in existingIds) }
        assertEquals(plan.toAdd.size, plan.toAdd.map { it.id }.toSet().size)
    }

    @Test
    fun fileCredentialsGetFreshIdsEvenWhenTheyMatchStoredOnes() {
        val plan = BackupFile.merge(
            listOf(BackupFile.PlainCredential("openai", "A", AuthMethod.API_KEY, 1, null, "sk-1", id = "same-id")),
            listOf(BackupFile.PlainCredential("openai", "B", AuthMethod.API_KEY, 1, null, "sk-2", id = "same-id")),
        )
        assertEquals(1, plan.toAdd.size)
        assertNotEquals("same-id", plan.toAdd.single().id)
    }

    /**
     * When BYOKY_KOTLIN_EXPORT_DIR is set, leave the round-trip export and
     * its expected plaintexts there so core's Node decrypt() can be pointed
     * at them (see the report for the script).
     */
    private fun exportForNodeCheck(file: String, password: String, original: List<BackupFile.PlainCredential>) {
        val dir = System.getenv("BYOKY_KOTLIN_EXPORT_DIR") ?: return
        File(dir).mkdirs()
        File(dir, "kotlin-export.byoky").writeText(file)
        File(dir, "kotlin-export.password").writeText(password)
        val expected = JSONArray()
        original.forEach {
            expected.put(JSONObject()
                .put("providerId", it.providerId)
                .put("label", it.label)
                .put("authMethod", BackupFile.authMethodName(it.authMethod))
                .put("baseUrl", it.baseUrl ?: JSONObject.NULL)
                .put("secret", it.secret))
        }
        File(dir, "kotlin-export.expected.json").writeText(expected.toString())
    }
}
