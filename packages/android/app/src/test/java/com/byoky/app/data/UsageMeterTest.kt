package com.byoky.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class UsageMeterTest {

    private fun meter(providerId: String, status: Int = 200, eventStream: Boolean = false) =
        UsageMeter(providerId).also {
            it.status = status
            it.contentType = if (eventStream) "text/event-stream" else "application/json"
        }

    /** Feed [text] in chunks of [size] characters, as a stream would arrive, to the end. */
    private fun UsageMeter.feed(text: String, size: Int = 7, complete: Boolean = true): UsageMeter {
        var i = 0
        while (i < text.length) {
            onText(text.substring(i, minOf(text.length, i + size)))
            i += size
        }
        this.complete = complete
        return this
    }

    @Test
    fun anthropicStreamCombinesMessageStartAndDeltaWithCacheTokens() {
        val sse = """
            event: message_start
            data: {"type":"message_start","message":{"usage":{"input_tokens":25,"cache_creation_input_tokens":100,"cache_read_input_tokens":1000,"output_tokens":1}}}

            event: content_block_delta
            data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"\"usage\": {\"output_tokens\": 0}"}}

            event: message_delta
            data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":15}}

        """.trimIndent()
        val m = meter("anthropic", eventStream = true).feed(sse)
        assertEquals(UsageParser.TokenUsage(1125, 15), m.usage())
        assertEquals(UsageLedger.Usage(1, 1125, 15), m.counted(estimate = true))
    }

    @Test
    fun openAiStreamUsesTheFinalUsageChunk() {
        val sse = "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}],\"usage\":null}\n\n" +
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":34}}\n\n" +
            "data: [DONE]\n\n"
        assertEquals(UsageParser.TokenUsage(12, 34), meter("openai", eventStream = true).feed(sse, 5).usage())
    }

    @Test
    fun geminiStreamAddsThinkingTokensToOutput() {
        val sse = "data: {\"candidates\":[],\"usageMetadata\":{\"promptTokenCount\":3,\"candidatesTokenCount\":1}}\r\n\r\n" +
            "data: {\"candidates\":[],\"usageMetadata\":{\"promptTokenCount\":3,\"candidatesTokenCount\":9,\"thoughtsTokenCount\":20}}\r\n\r\n"
        assertEquals(UsageParser.TokenUsage(3, 29), meter("gemini", eventStream = true).feed(sse).usage())
    }

    @Test
    fun cohereStreamReadsMessageEnd() {
        val sse = "event: message-end\ndata: {\"type\":\"message-end\",\"delta\":{\"usage\":{\"tokens\":{\"input_tokens\":7,\"output_tokens\":8}}}}\n\n"
        assertEquals(UsageParser.TokenUsage(7, 8), meter("cohere", eventStream = true).feed(sse).usage())
    }

    @Test
    fun responsesApiCompletedEvent() {
        val sse = "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":40,\"output_tokens\":2}}}\n\n"
        assertEquals(UsageParser.TokenUsage(40, 2), meter("openai", eventStream = true).feed(sse).usage())
    }

    @Test
    fun plainJsonBodies() {
        assertEquals(
            UsageParser.TokenUsage(10, 5),
            meter("anthropic").feed("{\"content\":[],\"usage\":{\"input_tokens\":10,\"output_tokens\":5}}").usage(),
        )
        // Embeddings report prompt tokens only.
        assertEquals(
            UsageParser.TokenUsage(8, 0),
            meter("openai").feed("{\"data\":[],\"usage\":{\"prompt_tokens\":8,\"total_tokens\":8}}").usage(),
        )
    }

    @Test
    fun usageIsReadFromBodiesLargerThanTheParseLimit() {
        // The old 1 MiB log capture counted these as 0 tokens.
        val filler = "x".repeat(UsageMeter.JSON_LIMIT + 10)
        val body = "{\"choices\":[{\"message\":{\"content\":\"$filler \\\"usage\\\": {\\\"prompt_tokens\\\": 0}\"}}]," +
            "\"usage\":{\"prompt_tokens\":111,\"completion_tokens\":222}}"
        val m = meter("openai").feed(body, 64 * 1024)
        assertEquals(UsageParser.TokenUsage(111, 222), m.usage())
    }

    @Test
    fun largeStreamsStillCount() {
        val sb = StringBuilder()
        repeat(20_000) { sb.append("data: {\"choices\":[{\"delta\":{\"content\":\"${"y".repeat(60)}\"}}]}\n\n") }
        sb.append("data: {\"choices\":[],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":6000}}\n\n")
        assertEquals(UsageParser.TokenUsage(5, 6000), meter("openai", eventStream = true).feed(sb.toString(), 8192).usage())
    }

    @Test
    fun missingUsageOnASuccessfulGenerationIsEstimatedFromSize() {
        val body = "{\"text\":\"" + "z".repeat(4001) + "\"}"
        val m = meter("cohere").feed(body)
        m.requestBytes = 801
        val counted = m.counted(estimate = true)!!
        assertEquals(201, counted.inputTokens)
        assertEquals((body.length + 3L) / 4, counted.outputTokens)
    }

    @Test
    fun endpointsThatDontQualifyAreNotEstimated() {
        // Embeddings, images, audio, local servers: the caller passes estimate = false.
        val m = meter("openai").feed("{\"data\":[{\"b64_json\":\"" + "A".repeat(100_000) + "\"}]}")
        assertEquals(UsageLedger.Usage(1, 0, 0), m.counted(estimate = false))
    }

    @Test
    fun aStreamCutOffPartWayKeepsTheReportedInputAndEstimatesTheRest() {
        val partial = "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":500,\"output_tokens\":1}}}\n\n" +
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"" + "w".repeat(400) + "\"}}\n\n"
        val m = meter("anthropic", eventStream = true).feed(partial, complete = false)
        m.requestBytes = 99_999
        assertNull(m.usage())
        val counted = m.counted(estimate = true)!!
        assertEquals(500, counted.inputTokens)
        assertEquals((partial.length + 3L) / 4, counted.outputTokens)
    }

    @Test
    fun aCutOffStreamFillsOnlyTheMissingCounts() {
        // Gemini reports running totals; a cancelled stream keeps the last ones.
        val sse = "data: {\"usageMetadata\":{\"promptTokenCount\":30,\"candidatesTokenCount\":0}}\n\n"
        val m = meter("gemini", eventStream = true).feed(sse, complete = false)
        val counted = m.counted(estimate = true)!!
        assertEquals(30, counted.inputTokens)
        assertEquals((sse.length + 3L) / 4, counted.outputTokens)
    }

    @Test
    fun onlySuccessfulResponsesCount() {
        assertNull(meter("openai", status = 400).feed("{\"error\":{}}").counted(estimate = true))
        assertNull(meter("anthropic", status = 500).feed("{\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}").counted(estimate = true))
        assertNull(meter("openai", status = 302).feed("").counted(estimate = true))
        assertNull(UsageMeter("openai").counted(estimate = true)) // never got a response
        assertEquals(UsageLedger.Usage(1, 0, 0), meter("openai").feed("{\"data\":[]}").counted(estimate = false))
    }
}
