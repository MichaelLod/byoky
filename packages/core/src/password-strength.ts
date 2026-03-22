export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Too weak' | 'Weak' | 'Fair' | 'Strong' | 'Very strong';
  feedback: string[];
}

const COMMON_PASSWORDS = new Set([
  'password', '12345678', 'qwerty12', 'letmein12', 'welcome1',
  'monkey12', 'dragon12', 'master12', 'abc12345', 'password1',
  'password12', 'iloveyou1', 'sunshine1', 'trustno1', 'princess1',
  'football1', 'shadow123', 'michael1', 'jordan123', 'superman1',
  'password123', 'admin12345', 'letmein123', 'p@ssw0rd', 'p@ssw0rd1',
  'qwerty1234', 'changeme12', 'welcome123', '1234567890', 'baseball1',
  'starwars12', 'whatever1', 'passw0rd1', 'mustang12', 'access1234',
  'charlie123', 'donald1234', 'maggie1234', 'master1234', 'michael123',
  'jennifer1', 'hunter1234', 'thomas1234', 'corvette12', 'robert1234',
  'summer1234', 'george1234', 'harley1234', 'cheese1234', 'computer1',
  'internet1', 'secret1234', 'diamond1', 'chicken123', 'pepper1234',
  'jessica123', 'hannah1234', 'ginger1234', 'joshua1234', 'abcdefgh1',
  'qwertyuiop', 'asdfghjkl1', 'zxcvbnm123', '1q2w3e4r5t', 'passpass1',
]);

export function checkPasswordStrength(password: string): PasswordStrength {
  const feedback: string[] = [];
  let score = 0;

  if (password.length < MIN_PASSWORD_LENGTH) {
    feedback.push('Use at least 12 characters');
    return { score: 0, label: 'Too weak', feedback };
  } else {
    score++;
    if (password.length >= 16) score++;
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    feedback.push('This is a commonly used password');
    return { score: 0, label: 'Too weak', feedback };
  }

  // Check character diversity
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbol = /[^a-zA-Z0-9]/.test(password);
  const charTypes = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;

  if (charTypes < 2) {
    feedback.push('Mix uppercase, lowercase, numbers, and symbols');
  } else if (charTypes >= 3) {
    score++;
  }
  if (charTypes >= 4) {
    score++;
  }

  // Check for repeated characters (e.g. aaaaaa)
  if (/(.)\1{3,}/.test(password)) {
    feedback.push('Avoid repeated characters');
    score = Math.max(0, score - 1);
  }

  // Check for sequential patterns (e.g. 123456, abcdef)
  if (/(?:012|123|234|345|456|567|678|789|abc|bcd|cde|def)/i.test(password)) {
    feedback.push('Avoid sequential patterns');
    score = Math.max(0, score - 1);
  }

  const capped = Math.min(4, Math.max(0, score)) as 0 | 1 | 2 | 3 | 4;
  const labels: Record<number, PasswordStrength['label']> = {
    0: 'Too weak',
    1: 'Weak',
    2: 'Fair',
    3: 'Strong',
    4: 'Very strong',
  };

  if (feedback.length === 0 && capped < 3) {
    feedback.push('Add more character variety or length');
  }

  return { score: capped, label: labels[capped], feedback };
}

export const MIN_PASSWORD_LENGTH = 12;
