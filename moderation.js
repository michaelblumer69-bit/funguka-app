// Content moderation system for FUNGUKA
// Flags confessions containing dangerous keywords for human review

const FLAGGED_KEYWORDS = {
  // Self-harm / suicide
  selfharm: ['kill myself', 'suicide', 'end my life', 'want to die', 'better off dead', 
             'no reason to live', 'hurt myself', 'self harm', 'self-harm', 'slit my',
             'overdose on', 'jump off', 'hang myself'],

  // Violence / threats
  violence: ['murder', 'kill someone', 'going to kill', 'planning to kill', 'shoot up',
             'bomb', 'terrorist', 'massacre', 'stab', 'poison someone'],

  // CSAM / exploitation (immediate hard block)
  exploitation: ['child porn', 'cp ', 'underage sex', 'minor sex', 'molest a child',
                 'rape a child', 'pedophile', 'preteen', 'young girl naked'],

  // Doxxing / personal info
  doxxing: ['ssn ', 'social security', 'credit card number', 'home address is',
            'phone number is', 'full name is', 'lives at'],

  // Hate speech
  hatespeech: ['nigger', 'faggot', 'kike', 'chink', 'wetback', 'towelhead']
};

const SEVERITY_WEIGHTS = {
  exploitation: 100,  // Auto-block
  violence: 50,
  selfharm: 40,
  doxxing: 30,
  hatespeech: 25
};

function moderateContent(text) {
  const lowerText = text.toLowerCase();
  let score = 0;
  let flags = [];
  let shouldBlock = false;

  for (const [category, keywords] of Object.entries(FLAGGED_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        score += SEVERITY_WEIGHTS[category];
        flags.push(`${category}: "${keyword}"`);

        if (category === 'exploitation') {
          shouldBlock = true;
        }
      }
    }
  }

  return {
    score,
    flags,
    shouldBlock,
    isFlagged: score >= 20,  // Flag for review if score >= 20
    flagReason: flags.join('; ')
  };
}

function getModerationStats() {
  return {
    totalFlagged: 0,  // Populated by caller
    totalBlocked: 0,
    categories: Object.keys(FLAGGED_KEYWORDS)
  };
}

module.exports = { moderateContent, getModerationStats, FLAGGED_KEYWORDS };
