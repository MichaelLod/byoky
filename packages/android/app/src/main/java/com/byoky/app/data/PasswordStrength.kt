package com.byoky.app.data

/**
 * Port of `checkPasswordStrength` in packages/core/src/password-strength.ts,
 * the rule the extension applies to export passwords. Keep the two in sync so
 * a password accepted on one platform is accepted on the other.
 */
data class PasswordStrength(
    /** 0 (too weak) … 4 (very strong). */
    val score: Int,
    val label: String,
    val feedback: List<String>,
) {
    companion object {
        const val MIN_LENGTH = 12

        /** Minimum score for an export password (extension: `strength.score < 2` is rejected). */
        const val MIN_EXPORT_SCORE = 2

        private val COMMON_PASSWORDS = setOf(
            "password", "12345678", "qwerty12", "letmein12", "welcome1",
            "monkey12", "dragon12", "master12", "abc12345", "password1",
            "password12", "iloveyou1", "sunshine1", "trustno1", "princess1",
            "football1", "shadow123", "michael1", "jordan123", "superman1",
            "password123", "admin12345", "letmein123", "p@ssw0rd", "p@ssw0rd1",
            "qwerty1234", "changeme12", "welcome123", "1234567890", "baseball1",
            "starwars12", "whatever1", "passw0rd1", "mustang12", "access1234",
            "charlie123", "donald1234", "maggie1234", "master1234", "michael123",
            "jennifer1", "hunter1234", "thomas1234", "corvette12", "robert1234",
            "summer1234", "george1234", "harley1234", "cheese1234", "computer1",
            "internet1", "secret1234", "diamond1", "chicken123", "pepper1234",
            "jessica123", "hannah1234", "ginger1234", "joshua1234", "abcdefgh1",
            "qwertyuiop", "asdfghjkl1", "zxcvbnm123", "1q2w3e4r5t", "passpass1",
        )

        private val LABELS = listOf("Too weak", "Weak", "Fair", "Strong", "Very strong")
        private val REPEATED = Regex("(.)\\1{3,}")
        private val SEQUENTIAL = Regex("(?:012|123|234|345|456|567|678|789|abc|bcd|cde|def)", RegexOption.IGNORE_CASE)

        fun check(password: String): PasswordStrength {
            val feedback = mutableListOf<String>()
            var score = 0

            if (password.length < MIN_LENGTH) {
                feedback.add("Use at least 12 characters")
                return PasswordStrength(0, LABELS[0], feedback)
            }
            score++
            if (password.length >= 16) score++

            if (password.lowercase() in COMMON_PASSWORDS) {
                feedback.add("This is a commonly used password")
                return PasswordStrength(0, LABELS[0], feedback)
            }

            val hasLower = password.any { it in 'a'..'z' }
            val hasUpper = password.any { it in 'A'..'Z' }
            val hasDigit = password.any { it in '0'..'9' }
            val hasSymbol = password.any { it !in 'a'..'z' && it !in 'A'..'Z' && it !in '0'..'9' }
            val charTypes = listOf(hasLower, hasUpper, hasDigit, hasSymbol).count { it }

            if (charTypes < 2) {
                feedback.add("Mix uppercase, lowercase, numbers, and symbols")
            } else if (charTypes >= 3) {
                score++
            }
            if (charTypes >= 4) score++

            if (REPEATED.containsMatchIn(password)) {
                feedback.add("Avoid repeated characters")
                score = maxOf(0, score - 1)
            }
            if (SEQUENTIAL.containsMatchIn(password)) {
                feedback.add("Avoid sequential patterns")
                score = maxOf(0, score - 1)
            }

            val capped = score.coerceIn(0, 4)
            if (feedback.isEmpty() && capped < 3) feedback.add("Add more character variety or length")
            return PasswordStrength(capped, LABELS[capped], feedback)
        }

        /** The extension's export rule: at least 12 characters and score ≥ 2. */
        fun isAcceptableForExport(password: String): Boolean =
            password.length >= MIN_LENGTH && check(password).score >= MIN_EXPORT_SCORE
    }
}
