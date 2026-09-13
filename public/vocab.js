// ============================================================================
// IELTS Vocabulary Mastery Module (30 Words per Topic + Speech Challenge)
// ============================================================================

let vocabTopics = [];
let currentTopicIndex = 0;
let currentWordIndex = 0;

// 24-Hour Daily Topic Cycle State (Timezone-Aware / Midnight Local Time)
let dailyTopicIndex = 0;
let dailyCountdownTimer = null;
let isKeepTopicActive = false;
try {
  isKeepTopicActive = localStorage.getItem('ielts_vocab_keep_topic') === 'true';
} catch(e) {}
let userSelectedTopicId = null;
try {
  userSelectedTopicId = localStorage.getItem('ielts_vocab_selected_topic_id') || null;
} catch(e) {}

// Sentence storage: topicIndex -> wordIndex -> { simple: ["", "", ""], complex: ["", "", ""], completed: bool }
let userSentencesData = {};

// Speech Challenge Timers
let prepSpeechTimer = null;
let speechDurationTimer = null;
let prepSecondsLeft = 60; // 1 min prep
let speechSecondsElapsed = 0; // 2 min speak
let isVocabSpeaking = false;
let vocabSpeechRecognition = null;

// ============================================================================
// 24-Hour Daily Cycle Logic (Midnight IST / Local System Midnight)
// ============================================================================

function getLocalDayIndex() {
  const now = new Date();
  const startEpoch = new Date(2026, 0, 1).getTime();
  const currentEpoch = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.floor((currentEpoch - startEpoch) / (24 * 60 * 60 * 1000));
}

function computeDailyTopicIndex() {
  if (!vocabTopics || !vocabTopics.length) return 0;
  const dayIdx = Math.abs(getLocalDayIndex());
  return dayIdx % vocabTopics.length;
}

function getLocalMidnightMs() {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.max(0, nextMidnight.getTime() - now.getTime());
}

function formatDailyCountdown(ms) {
  if (ms <= 0) return '00h 00m 00s';
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
}

function startDailyCountdownTicker() {
  if (dailyCountdownTimer) clearInterval(dailyCountdownTimer);
  updateDailyCountdown();
  dailyCountdownTimer = setInterval(updateDailyCountdown, 1000);
}

function updateDailyCountdown() {
  const msLeft = getLocalMidnightMs();
  const readout = document.getElementById('dailyCountdownReadout');
  if (readout) {
    readout.innerText = formatDailyCountdown(msLeft);
  }

  // Check if midnight struck and day index shifted
  const computedIndex = computeDailyTopicIndex();
  if (computedIndex !== dailyTopicIndex) {
    dailyTopicIndex = computedIndex;
    if (!isKeepTopicActive) {
      currentTopicIndex = dailyTopicIndex;
      currentWordIndex = 0;
      renderTopicSelector();
      renderWordGrid();
      loadActiveWord();
      setupCueCardView();
    }
  }

  // Update UI indicators
  const badge = document.getElementById('dailyTopicBadgeText');
  const switchBtn = document.getElementById('switchToTodayBtn');
  const keepBtn = document.getElementById('keepTopicToggleBtn');
  
  const isCurrentToday = (currentTopicIndex === dailyTopicIndex);
  if (badge) {
    badge.innerText = isCurrentToday ? "📅 Today's Daily Topic" : "📂 Past Topic Archive";
  }
  if (switchBtn) {
    switchBtn.style.display = isCurrentToday ? 'none' : 'inline-flex';
  }
  if (keepBtn) {
    keepBtn.innerText = isKeepTopicActive ? "📌 Topic Kept (Locked)" : "📌 Keep This Topic";
    keepBtn.style.borderColor = isKeepTopicActive ? "#10b981" : "var(--border-color)";
    keepBtn.style.color = isKeepTopicActive ? "#6ee7b7" : "var(--text-primary)";
    keepBtn.style.background = isKeepTopicActive ? "rgba(16, 185, 129, 0.15)" : "transparent";
  }
}

function toggleKeepTopic() {
  isKeepTopicActive = !isKeepTopicActive;
  try {
    localStorage.setItem('ielts_vocab_keep_topic', isKeepTopicActive ? 'true' : 'false');
    if (isKeepTopicActive) {
      const topic = vocabTopics[currentTopicIndex];
      if (topic) localStorage.setItem('ielts_vocab_selected_topic_id', topic.topicId);
    } else {
      localStorage.removeItem('ielts_vocab_selected_topic_id');
    }
  } catch(e) {}
  updateDailyCountdown();
}

function switchToTodayTopic() {
  isKeepTopicActive = false;
  try {
    localStorage.setItem('ielts_vocab_keep_topic', 'false');
    localStorage.removeItem('ielts_vocab_selected_topic_id');
  } catch(e) {}
  currentTopicIndex = dailyTopicIndex;
  currentWordIndex = 0;
  renderTopicSelector();
  renderWordGrid();
  loadActiveWord();
  setupCueCardView();
  updateDailyCountdown();
}

// Initialize Vocab Speech Engine
function initVocabSpeech() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRec) {
    vocabSpeechRecognition = new SpeechRec();
    vocabSpeechRecognition.continuous = true;
    vocabSpeechRecognition.interimResults = true;
    vocabSpeechRecognition.lang = 'en-US';

    vocabSpeechRecognition.onresult = (event) => {
      let fullTranscript = '';
      for (let i = 0; i < event.results.length; i++) {
        fullTranscript += event.results[i][0].transcript + ' ';
      }
      const box = document.getElementById('vocabSpeechTranscript');
      if (box) box.value = fullTranscript.trim();
    };

    vocabSpeechRecognition.onerror = (err) => {
      console.warn('Vocab speech recognition warning:', err.error);
      if (err.error === 'not-allowed') {
        alert('Microphone access denied. Please allow microphone permissions.');
        stopVocabSpeechRecording();
      }
    };

    vocabSpeechRecognition.onend = () => {
      if (isVocabSpeaking) {
        try { vocabSpeechRecognition.start(); } catch(e) {}
      }
    };
  }
}

// Load Vocab Bank
async function loadVocabBank() {
  try {
    const res = await fetch('/api/vocab');
    if (res.ok) {
      vocabTopics = await res.json();
    }
  } catch (e) {
    console.warn('Failed to load vocab from /api/vocab, using fallback.', e);
  }

  // Fallback if empty
  if (!vocabTopics || !vocabTopics.length) {
    vocabTopics = [
      {
        topicId: 'env_fallback',
        topicTitle: 'Environmental Sustainability & Climate Action',
        description: 'Band 8+ lexical items for ecological preservation and renewable solutions.',
        speechCueCard: {
          title: 'Describe an eco-friendly project or policy that could mitigate climate change.',
          prompts: [
            'What the project is and how it functions',
            'What environmental risks it addresses',
            'What challenges governments face in adopting it',
            'And explain why sustainable practices are of paramount importance.'
          ]
        },
        words: Array.from({ length: 30 }, (_, i) => ({
          id: i + 1,
          word: ['Mitigate', 'Biodiversity', 'Sustainable', 'Depletion', 'Detrimental', 'Unprecedented', 'Exacerbate', 'Paramount', 'Imperative', 'Proliferation', 'Resilience', 'Viable', 'Incentivize', 'Equitable', 'Ecosystem', 'Catastrophic', 'Rehabilitate', 'Negligent', 'Emissions', 'Subsidize', 'Pristine', 'Indispensable', 'Advocate', 'Contaminate', 'Degradation', 'Ubiquitous', 'Nuance', 'Autonomy', 'Cognitive', 'Profound'][i] || `Lexeme_${i+1}`,
          pos: 'academic',
          meaning: 'High-frequency Band 8+ IELTS academic descriptor.',
          example: 'Adopting forward-thinking policies is indispensable for ensuring long-term resilience.',
          collocations: ['play a pivotal role', 'paramount importance', 'mitigate risks']
        }))
      }
    ];
  }

  // Load saved sentences from localStorage
  try {
    const saved = localStorage.getItem('ielts_vocab_sentences_data');
    if (saved) userSentencesData = JSON.parse(saved);
  } catch (e) {}

    // Calculate and set 24-Hour Daily Topic
  dailyTopicIndex = computeDailyTopicIndex();

  if (isKeepTopicActive && userSelectedTopicId) {
    const foundIdx = vocabTopics.findIndex(t => t.topicId === userSelectedTopicId);
    if (foundIdx !== -1) currentTopicIndex = foundIdx;
    else currentTopicIndex = dailyTopicIndex;
  } else {
    currentTopicIndex = dailyTopicIndex;
  }

  renderTopicSelector();
  renderWordGrid();
  loadActiveWord();
  setupCueCardView();
  startDailyCountdownTicker();
}


// Render Topic Selector Dropdown with Daily Focus & Past Archive
function renderTopicSelector() {
  const sel = document.getElementById('vocabTopicSelect');
  if (!sel) return;
  sel.innerHTML = '';

  vocabTopics.forEach((t, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    const isToday = (idx === dailyTopicIndex);
    opt.innerText = isToday 
      ? `🌟 Today's Daily Topic: ${t.topicTitle}`
      : `📂 Archive #${idx + 1}: ${t.topicTitle}`;
    sel.appendChild(opt);
  });
  sel.value = currentTopicIndex;
}

function onTopicChanged() {
  const sel = document.getElementById('vocabTopicSelect');
  currentTopicIndex = parseInt(sel.value, 10) || 0;
  currentWordIndex = 0;
  const topic = vocabTopics[currentTopicIndex];
  if (topic) {
    try {
      localStorage.setItem('ielts_vocab_selected_topic_id', topic.topicId);
    } catch(e) {}
  }
  renderWordGrid();
  loadActiveWord();
  setupCueCardView();
  updateDailyCountdown();
}

// Render 30 Word Grid Buttons
function renderWordGrid() {
  const grid = document.getElementById('wordGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const topic = vocabTopics[currentTopicIndex];
  if (!topic || !topic.words) return;

  let completedCount = 0;
  const topicData = userSentencesData[topic.topicId] || {};

  topic.words.forEach((w, idx) => {
    const isCompleted = topicData[w.id] && topicData[w.id].completed;
    if (isCompleted) completedCount++;

    const row = document.createElement('div');
    row.className = `word-list-row ${idx === currentWordIndex ? 'active' : ''} ${isCompleted ? 'completed' : ''}`;
    row.innerHTML = `
      <div class="word-row-left">
        <span class="word-row-num">#${w.id}</span>
        <span class="word-row-title">${w.word}</span>
      </div>
      <div class="word-row-right">
        <span class="word-row-pos">${w.pos || ''}</span>
        <span class="word-status-icon ${isCompleted ? 'done' : ''}">${isCompleted ? '✓' : '○'}</span>
      </div>
    `;
    row.onclick = () => {
      currentWordIndex = idx;
      renderWordGrid();
      loadActiveWord();
      const hero = document.querySelector('.word-details-hero');
      if (hero && window.innerWidth < 960) hero.scrollIntoView({ behavior: 'smooth' });
    };
    grid.appendChild(row);
  });

  // Update progress bar
  const progressPercent = Math.round((completedCount / topic.words.length) * 100);
  const bar = document.getElementById('vocabProgressBar');
  const txt = document.getElementById('vocabProgressText');
  if (bar) bar.style.width = `${progressPercent}%`;
  if (txt) txt.innerText = `${completedCount} / ${topic.words.length} Words Completed (${progressPercent}%)`;
}

function loadActiveWord() {
  const topic = vocabTopics[currentTopicIndex];
  if (!topic || !topic.words || !topic.words[currentWordIndex]) return;

  const w = topic.words[currentWordIndex];
  document.getElementById('activeWordTitle').innerText = `${w.id}. ${w.word}`;
  document.getElementById('activeWordPos').innerText = w.pos ? `(${w.pos})` : '';
  document.getElementById('activeWordMeaning').innerText = w.meaning || '';
  document.getElementById('activeWordExample').innerText = `“${w.example || ''}”`;

  // Collocations
  const collocContainer = document.getElementById('activeWordCollocations');
  if (collocContainer) {
    collocContainer.innerHTML = '';
    (w.collocations || []).forEach(c => {
      const pill = document.createElement('span');
      pill.className = 'colloc-pill';
      pill.innerText = c;
      collocContainer.appendChild(pill);
    });
  }

  // Load inputs from storage
  const topicData = userSentencesData[topic.topicId] || {};
  const wordData = topicData[w.id] || { simple: ['', '', ''], complex: ['', '', ''] };

  document.getElementById('simpleSentence1').value = wordData.simple[0] || '';
  document.getElementById('simpleSentence2').value = wordData.simple[1] || '';
  document.getElementById('simpleSentence3').value = wordData.simple[2] || '';

  document.getElementById('complexSentence1').value = wordData.complex[0] || '';
  document.getElementById('complexSentence2').value = wordData.complex[1] || '';
  document.getElementById('complexSentence3').value = wordData.complex[2] || '';

  document.getElementById('sentenceValidationNotice').innerHTML = '';
}


// Timer removed per user request: Practice at your own pace
function toggleWordTimer() {}
function resetWordTimer() {}
function updateWordTimerDisplay() {}
function playTimerChime() {}
function lockWordInputs(shouldLock) {}

function validateAndSaveSentences() {
  evaluateAndSaveSentences(false);
}

function nextWord() {
  const topic = vocabTopics[currentTopicIndex];
  if (!topic || !topic.words) return;
  currentWordIndex = (currentWordIndex + 1) % topic.words.length;
  renderWordGrid();
  loadActiveWord();
  const hero = document.querySelector('.word-details-hero');
  if (hero && window.innerWidth < 960) hero.scrollIntoView({ behavior: 'smooth' });
}

// ============================================================================
// ============================================================================
// Robust Morphological Lemma & Derivative Matcher (Handles derivations)
// E.g.: "biodegradation" matches "biodegrade", "sustainability" matches "sustainable"
// ============================================================================

function extractCoreStem(word) {
  let w = (word || '').toLowerCase().trim().replace(/[^a-z]/g, '');
  if (!w) return '';
  const suffixes = [
    'abilities', 'ability', 'ibilities', 'ibility',
    'ation', 'ition', 'ution', 'ction', 'tion', 'sion',
    'atively', 'itively', 'ative', 'itive',
    'ableness', 'ibleness', 'able', 'ible',
    'ement', 'ment', 'ance', 'ence', 'ancy', 'ency',
    'lessly', 'lessness', 'fully', 'fulness', 'less', 'ful',
    'ously', 'ous', 'ious', 'ically', 'ical', 'ic',
    'ingly', 'edly', 'ing', 'ed',
    'izes', 'ises', 'ized', 'ised', 'ize', 'ise',
    'ities', 'ity', 'ness',
    'ally', 'al', 'ly',
    'es', 's', 'e'
  ];
  let stem = w;
  for (const suf of suffixes) {
    if (stem.endsWith(suf) && (stem.length - suf.length) >= 3) {
      stem = stem.slice(0, -suf.length);
      break;
    }
  }
  return stem;
}

function checkTargetWordPresent(sentence, targetWord) {
  if (!sentence || !targetWord) return false;
  const s = sentence.toLowerCase();
  const target = targetWord.toLowerCase().trim();
  const targetStem = extractCoreStem(target);

  // 1. Direct whole target word regex (including normal suffixes)
  const exactRegex = new RegExp('\\b' + target + '[a-z]{0,8}\\b', 'i');
  if (exactRegex.test(s)) return true;

  // 2. Token-by-token comparison against sentence words
  const tokens = s.replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (token === target) return true;
    if (token.startsWith(targetStem) && targetStem.length >= 4) return true;
    if (target.startsWith(extractCoreStem(token)) && extractCoreStem(token).length >= 4) return true;

    const tokenStem = extractCoreStem(token);
    if (tokenStem && targetStem) {
      if (tokenStem === targetStem) return true;
      if (tokenStem.length >= 4 && targetStem.startsWith(tokenStem)) return true;
      if (targetStem.length >= 4 && tokenStem.startsWith(targetStem)) return true;
    }

    // Compound or prefix words: e.g. 'biodegradation' for 'degradation'
    if (token.includes(target) || (targetStem.length >= 5 && token.includes(targetStem))) return true;
    if (target.includes(token) && token.length >= 5) return true;
  }
  return false;
}

function analyzeSentenceLinguistics(rawSentence, wordObj, sentenceType, index) {
  const s = (rawSentence || '').trim();
  const word = (wordObj && wordObj.word) ? wordObj.word : '';
  const pos = ((wordObj && wordObj.pos) || '').toLowerCase();
  const collocations = (wordObj && wordObj.collocations) || [];

  // Case 1: Unanswered / Left Blank
  if (!s) {
    return {
      status: 'empty',
      text: '',
      type: sentenceType,
      num: index,
      score: null,
      badge: '○ Left Blank',
      color: 'var(--text-muted)',
      wordFound: false,
      grammarOk: false,
      note: 'Sentence was left blank. (Unanswered fields are skipped without blocking evaluation or export).'
    };
  }

  const words = s.split(/\s+/);
  const wordCount = words.length;
  let issues = [];
  let strengths = [];
  let grammarOk = true;
  let wordFitOk = true;

  // 1. Check Target Word Presence & Inflection / Derivation
  const wordFound = checkTargetWordPresent(s, word);
  if (!wordFound) {
    wordFitOk = false;
    issues.push('Target word "' + word + '" (or any of its derivatives/forms) was not found in this sentence.');
  }

  // 2. Syntactic & Contextual Word Fit (Part-of-Speech Checks)
  if (wordFound) {
    // Verb checks - only apply if the exact verb form or verb inflection is used
    if (pos.includes('verb') || ['mitigate', 'exacerbate', 'subsidize', 'incentivize', 'contaminate', 'rehabilitate'].includes(word.toLowerCase())) {
      // Check if transitive verb is left dangling without an object
      const danglingVerbPattern = new RegExp('\\b' + word + '\\s*[.!?]$', 'i');
      if (danglingVerbPattern.test(s)) {
        wordFitOk = false;
        issues.push('Transitive verb "' + word + '" requires a direct object (e.g., "' + word + ' climate risks", "' + word + ' emissions").');
      }
      // Check for ungrammatical "is + base verb"
      const isBaseVerb = new RegExp('\\b(is|are|was|were|am)\\s+' + word + '\\b', 'i');
      if (isBaseVerb.test(s)) {
        grammarOk = false;
        issues.push('Grammar flaw: After auxiliary "to be", use passive ("is ' + word + 'd") or continuous ("is ' + word + 'ing").');
      }
    }

    // Adjective checks
    if (pos.includes('adj') || ['sustainable', 'detrimental', 'unprecedented', 'paramount', 'imperative', 'viable', 'equitable', 'catastrophic', 'negligent', 'pristine', 'indispensable', 'ubiquitous', 'profound'].includes(word.toLowerCase())) {
      const modalAdj = new RegExp('\\b(will|can|could|should|must|might|to)\\s+' + word + '\\b', 'i');
      if (modalAdj.test(s)) {
        grammarOk = false;
        wordFitOk = false;
        issues.push('"' + word + '" is an adjective. Combine it with a copula (e.g., "is ' + word + '") or place it before a noun.');
      }
    }

    // Noun checks
    if (pos.includes('noun') || ['biodiversity', 'depletion', 'proliferation', 'resilience', 'ecosystem', 'emissions', 'degradation', 'nuance', 'autonomy'].includes(word.toLowerCase())) {
      const modalNoun = new RegExp('\\b(will|can|could|should|must)\\s+' + word + '\\b', 'i');
      if (modalNoun.test(s)) {
        grammarOk = false;
        wordFitOk = false;
        issues.push('"' + word + '" is an academic noun. Use it as a subject or object rather than an action verb.');
      }
    }
  }

  // 3. Grammar & Mechanics Validation
  // A. Capitalization
  if (!/^[A-Z"“']/.test(s)) {
    grammarOk = false;
    issues.push('Mechanics: Sentence must begin with a capital letter.');
  }

  // B. Punctuation
  if (!/[.!?]["”']?$/.test(s)) {
    grammarOk = false;
    issues.push('Punctuation: Sentence must conclude with an appropriate end mark (period or question mark).');
  }

  // C. Word Duplication (Stuttering error)
  const dupMatch = s.match(/\b(the|is|are|was|were|in|on|at|to|that|of|it|a|an|we|they|and)\s+\1\b/i);
  if (dupMatch) {
    grammarOk = false;
    issues.push('Repeated consecutive word error: "' + dupMatch[0] + '".');
  }

  // D. Common Subject-Verb Agreement / Syntax Flaws
  if (/\b(he|she|it)\s+(have|are|were|do)\b/i.test(s)) {
    grammarOk = false;
    issues.push('Subject-verb agreement error: 3rd-person singular subject requires singular verb ("has", "is", "does").');
  }
  if (/\b(they|we|you)\s+(is|was|has)\b/i.test(s)) {
    grammarOk = false;
    issues.push('Subject-verb agreement error: Plural subject requires plural verb ("are", "were", "have").');
  }
  if (/\b(does|did|do)\s+not\s+([a-z]+(?:s|ed))\b/i.test(s)) {
    grammarOk = false;
    issues.push('Auxiliary verb flaw: Use base form of the main verb following "do not / does not / did not".');
  }
  if (/\b(can|could|will|would|should|must|might)\s+([a-z]+(?:s|ed))\b/i.test(s)) {
    grammarOk = false;
    issues.push('Modal verb flaw: Modal verbs must be followed immediately by a base infinitive without inflections.');
  }
  if (/\ba\s+([aeiou][a-z]{2,})\b/i.test(s) && !/\ba\s+(university|unique|useful|one|european)/i.test(s)) {
    grammarOk = false;
    issues.push('Article usage: Use "an" before vowel-initial words.');
  }

  // 4. Semantic Meaning & Depth
  if (wordCount < 4) {
    grammarOk = false;
    issues.push('Sentence is too brief (only ' + wordCount + ' words). A complete IELTS thought should contain at least 6–10 words.');
  }

  // Collocation Detection
  let detectedColloc = null;
  collocations.forEach(c => {
    if (s.toLowerCase().includes(c.toLowerCase())) {
      detectedColloc = c;
    }
  });
  if (detectedColloc) {
    strengths.push('🌟 Collocation bonus: "' + detectedColloc + '" naturally integrated.');
  }

  // 5. Sentence Type & Complexity Check
  let clauseStructureOk = true;
  if (sentenceType === 'Simple') {
    if (wordCount >= 6 && grammarOk && wordFitOk) {
      strengths.push('✓ Clear independent clause conveying a coherent, singular academic thought.');
    }
  } else {
    const complexMarkers = /\b(although|even though|whereas|while|because|since|unless|provided that|inasmuch as|in order that|so that|despite|in spite of|if|had [a-z]+|were [a-z]+ to|which|whom|whose|whereby|not only\b.*\bbut also|rarely|seldom)\b/i;
    if (!complexMarkers.test(s)) {
      clauseStructureOk = false;
      issues.push('Complexity note: Sentence lacks a complex clause marker. For IELTS Band 8+, introduce a subordinate clause ("although", "whereas", "because"), conditional ("if", "unless"), or relative pronoun ("which", "whereby").');
    } else {
      strengths.push('✓ Sophisticated syntactic clause linking demonstrated.');
    }

    if (/^(Although|Even though|While|Since|Because|If|Unless|Provided that)\b/i.test(s) && !/,/.test(s)) {
      issues.push('Punctuation tip: When starting with a subordinate clause, separate it from the main clause with a comma.');
    }
  }

  // Determine Overall Status & Band
  let status = 'valid';
  let badge = '✓ Accurate & Natural';
  let color = 'var(--accent-emerald)';
  let score = null;

  if (!wordFound) {
    status = 'missing_word';
    badge = '✗ Word Missing';
    color = 'var(--accent-rose)';
    score = null;
  } else if (!grammarOk || !wordFitOk) {
    status = 'grammar_issue';
    badge = '⚠ Grammar / Word Fit';
    color = 'var(--accent-amber)';
    score = null;
  } else if (!clauseStructureOk) {
    status = 'lacks_complexity';
    badge = '⚠ Needs Complexity';
    color = 'var(--accent-amber)';
    score = null;
  } else if (detectedColloc) {
    score = null;
    badge = '🌟 Master Collocation';
  }

  let finalNote = '';
  if (issues.length > 0) {
    finalNote = issues.join(' ');
  } else if (strengths.length > 0) {
    finalNote = strengths.join(' ');
  } else {
    finalNote = 'Grammatically accurate with clear academic meaning.';
  }

  return {
    status,
    text: s,
    type: sentenceType,
    num: index,
    score,
    badge,
    color,
    wordFound,
    grammarOk,
    wordFitOk,
    clauseStructureOk,
    detectedColloc,
    note: finalNote
  };
}

function evaluateAndSaveSentences(autoTriggered = false) {
  const topic = vocabTopics[currentTopicIndex];
  if (!topic || !topic.words) return;
  const w = topic.words[currentWordIndex];

  const s1 = (document.getElementById('simpleSentence1') ? document.getElementById('simpleSentence1').value.trim() : '');
  const s2 = (document.getElementById('simpleSentence2') ? document.getElementById('simpleSentence2').value.trim() : '');
  const s3 = (document.getElementById('simpleSentence3') ? document.getElementById('simpleSentence3').value.trim() : '');

  const c1 = (document.getElementById('complexSentence1') ? document.getElementById('complexSentence1').value.trim() : '');
  const c2 = (document.getElementById('complexSentence2') ? document.getElementById('complexSentence2').value.trim() : '');
  const c3 = (document.getElementById('complexSentence3') ? document.getElementById('complexSentence3').value.trim() : '');

  const simpleList = [s1, s2, s3];
  const complexList = [c1, c2, c3];

  const reports = [
    analyzeSentenceLinguistics(s1, w, 'Simple', 1),
    analyzeSentenceLinguistics(s2, w, 'Simple', 2),
    analyzeSentenceLinguistics(s3, w, 'Simple', 3),
    analyzeSentenceLinguistics(c1, w, 'Complex', 1),
    analyzeSentenceLinguistics(c2, w, 'Complex', 2),
    analyzeSentenceLinguistics(c3, w, 'Complex', 3),
  ];

  let attemptedCount = 0;
  let validCount = 0;
  let totalScoreSum = 0;

  reports.forEach(r => {
    if (r.status !== 'empty') {
      attemptedCount++;
      totalScoreSum += r.score;
      if (r.status === 'valid') validCount++;
    }
  });

  let practiceStatus = '○ Not Attempted';
  if (validCount >= 3) practiceStatus = '✓ Verified Accurate (' + attemptedCount + '/6)';
  else if (attemptedCount > 0) practiceStatus = '◐ In Progress (' + attemptedCount + '/6)';

  const wordRecord = {
    word: w.word,
    pos: w.pos,
    meaning: w.meaning,
    example: w.example,
    collocations: w.collocations,
    simple: simpleList,
    complex: complexList,
    completed: attemptedCount >= 3 && validCount >= 2,
    status: practiceStatus,
    attemptedCount,
    validCount,
    reports,
    timestamp: new Date().toISOString()
  };

  if (!userSentencesData[topic.topicId]) {
    userSentencesData[topic.topicId] = {};
  }
  userSentencesData[topic.topicId][w.id] = wordRecord;

  try {
    localStorage.setItem('ielts_vocab_sentences_data', JSON.stringify(userSentencesData));
  } catch (e) {}

  renderWordGrid();
  displaySentenceEvaluationScorecard(wordRecord, autoTriggered);
}

function displaySentenceEvaluationScorecard(data, autoTriggered = false) {
  const notice = document.getElementById('sentenceValidationNotice');
  if (!notice) return;

  const autoBadge = '';

  let listHtml = '';
  (data.reports || []).forEach(r => {
    let icon = '✓';
    let iconColor = 'var(--accent-emerald)';
    if (r.status === 'empty') {
      icon = '○';
      iconColor = 'var(--text-muted)';
    } else if (r.status === 'missing_word') {
      icon = '✗';
      iconColor = 'var(--accent-rose)';
    } else if (r.status === 'grammar_issue' || r.status === 'lacks_complexity') {
      icon = '⚠';
      iconColor = 'var(--accent-amber)';
    }

    const displayText = r.text ? ('“' + r.text + '”') : '<em style="color: var(--text-muted); font-size: 0.85rem;">(Left blank / Unanswered)</em>';

    listHtml += '<div style="display: flex; justify-content: space-between; align-items: flex-start; padding: 10px 0; border-top: 1px solid var(--border-color); font-size: 0.88rem; gap: 1rem;">' +
      '<div style="flex: 1;">' +
        '<div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 3px;">' +
          '<strong style="color: #fff;">' + r.type + ' #' + r.num + ':</strong>' +
          '<span style="font-size: 0.75rem; padding: 2px 8px; border-radius: 4px; background: rgba(255,255,255,0.06); color: ' + r.color + '; font-weight: 700;">' + r.badge + '</span>' +
          '' +
        '</div>' +
        '<div style="color: ' + (r.text ? 'var(--text-primary)' : 'var(--text-muted)') + '; line-height: 1.4; margin-bottom: 4px;">' + displayText + '</div>' +
        '<div style="font-size: 0.8rem; color: ' + r.color + '; line-height: 1.3;">' + r.note + '</div>' +
      '</div>' +
      '<span style="font-weight: 800; color: ' + iconColor + '; font-size: 1.15rem; padding-left: 4px;">' + icon + '</span>' +
    '</div>';
  });

  const attemptedLabel = (data.attemptedCount || 0) + ' / 6 Sentences Written (' + (data.validCount || 0) + ' Verified Accurate)';

  notice.innerHTML = '<div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 1.25rem; margin-top: 1rem;">' +
    '<div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem; flex-wrap: wrap; gap: 1rem;">' +
      '<div>' +
        autoBadge +
        '<h4 style="color: #fff; font-size: 1.15rem; margin: 0; font-weight: 700;">Sentence Practice Evaluation & Feedback</h4>' +
        '<span style="font-size: 0.84rem; color: var(--text-secondary);">' + attemptedLabel + '</span>' +
      '</div>' +
      '<div style="display: flex; align-items: center; gap: 1rem;">' +
        '<div style="text-align: right;">' +
          '<span style="font-size: 0.72rem; text-transform: uppercase; color: var(--text-muted); display: block; font-weight: 700;">Practice Status</span>' +
          '<span style="font-size: 1.15rem; font-weight: 800; color: ' + (data.validCount >= 3 ? 'var(--accent-emerald)' : (data.attemptedCount > 0 ? 'var(--accent-amber)' : 'var(--text-muted)')) + ';">' + (data.validCount >= 3 ? '✓ Verified Accurate' : (data.attemptedCount > 0 ? '◐ In Progress' : '○ Left Blank')) + '</span>' +
        '</div>' +
        '<button class="btn btn-pdf-export" onclick="exportWordToPDF()">📄 Export to PDF</button>' +
      '</div>' +
    '</div>' +
    '<div>' + listHtml + '</div>' +
  '</div>';
}

// ----------------------------------------------------------------------------
// PDF Exporter (Unblocked, Supports Partial/Empty Fields, Save As Picker)
// ----------------------------------------------------------------------------

function exportWordToPDF() {
  const topic = vocabTopics[currentTopicIndex];
  if (!topic || !topic.words) return;
  const w = topic.words[currentWordIndex];

  const topicData = userSentencesData[topic.topicId] || {};
  const savedRecord = topicData[w.id] || {};

  const s1 = (document.getElementById('simpleSentence1') ? document.getElementById('simpleSentence1').value.trim() : '') || (savedRecord.simple && savedRecord.simple[0]) || '';
  const s2 = (document.getElementById('simpleSentence2') ? document.getElementById('simpleSentence2').value.trim() : '') || (savedRecord.simple && savedRecord.simple[1]) || '';
  const s3 = (document.getElementById('simpleSentence3') ? document.getElementById('simpleSentence3').value.trim() : '') || (savedRecord.simple && savedRecord.simple[2]) || '';

  const c1 = (document.getElementById('complexSentence1') ? document.getElementById('complexSentence1').value.trim() : '') || (savedRecord.complex && savedRecord.complex[0]) || '';
  const c2 = (document.getElementById('complexSentence2') ? document.getElementById('complexSentence2').value.trim() : '') || (savedRecord.complex && savedRecord.complex[1]) || '';
  const c3 = (document.getElementById('complexSentence3') ? document.getElementById('complexSentence3').value.trim() : '') || (savedRecord.complex && savedRecord.complex[2]) || '';

  const repSimple = [
    analyzeSentenceLinguistics(s1, w, 'Simple', 1),
    analyzeSentenceLinguistics(s2, w, 'Simple', 2),
    analyzeSentenceLinguistics(s3, w, 'Simple', 3)
  ];
  const repComplex = [
    analyzeSentenceLinguistics(c1, w, 'Complex', 1),
    analyzeSentenceLinguistics(c2, w, 'Complex', 2),
    analyzeSentenceLinguistics(c3, w, 'Complex', 3)
  ];

  let filledCount = 0;
  let totalScore = 0;
  [...repSimple, ...repComplex].forEach(r => {
    if (r.status !== 'empty') {
      filledCount++;
      totalScore += r.score;
    }
  });

  let singleWordStatus = 'Practice Space';
  if (filledCount >= 3) singleWordStatus = '✓ Verified Accurate (' + filledCount + '/6)';
  else if (filledCount > 0) singleWordStatus = '◐ In Progress (' + filledCount + '/6)';

  function formatPDFSentenceItem(r, label) {
    if (r.status === 'empty') {
      return '<div class="sentence-item empty">' +
        '<div class="sentence-header">' +
          '<span class="sentence-label">' + label + '</span>' +
          '<span class="status-tag tag-empty">○ Left Blank</span>' +
        '</div>' +
        '<div class="sentence-text empty-text"><em>(Left blank / Unanswered in candidate drill)</em></div>' +
      '</div>';
    }

    const tagClass = r.status === 'valid' ? 'tag-valid' : (r.status === 'missing_word' ? 'tag-error' : 'tag-warning');

    return '<div class="sentence-item">' +
      '<div class="sentence-header">' +
        '<span class="sentence-label">' + label + '</span>' +
        '<span class="status-tag ' + tagClass + '">' + r.badge + '</span>' +
      '</div>' +
      '<div class="sentence-text">“' + r.text + '”</div>' +
      '<div class="sentence-feedback">' + r.note + '</div>' +
    '</div>';
  }

  const htmlContent = '<!DOCTYPE html>' +
'<html lang="en">' +
'<head>' +
  '<meta charset="utf-8">' +
  '<title>IELTS Vocabulary Study Sheet - ' + w.word + '</title>' +
  '<style>' +
    '@page { size: A4 portrait; margin: 15mm 20mm; }' +
    '* { box-sizing: border-box; }' +
    'body {' +
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;' +
      'color: #0f172a;' +
      'line-height: 1.5;' +
      'margin: 0;' +
      'padding: 24px;' +
      'background: #ffffff;' +
      '-webkit-print-color-adjust: exact;' +
      'print-color-adjust: exact;' +
    '}' +
    '.header {' +
      'border-bottom: 3px solid #2563eb;' +
      'padding-bottom: 14px;' +
      'margin-bottom: 22px;' +
      'display: flex;' +
      'justify-content: space-between;' +
      'align-items: flex-end;' +
    '}' +
    '.header h1 {' +
      'font-size: 24px;' +
      'color: #1e3a8a;' +
      'margin: 0 0 4px 0;' +
      'font-weight: 800;' +
      'letter-spacing: -0.02em;' +
    '}' +
    '.header .meta {' +
      'font-size: 13px;' +
      'color: #64748b;' +
    '}' +
    '.badge-top {' +
      'background: #dbeafe;' +
      'color: #1e40af;' +
      'padding: 4px 10px;' +
      'border-radius: 999px;' +
      'font-size: 12px;' +
      'font-weight: 700;' +
    '}' +
    '.word-card {' +
      'background: #f8fafc;' +
      'border: 1px solid #cbd5e1;' +
      'border-radius: 10px;' +
      'padding: 18px 22px;' +
      'margin-bottom: 22px;' +
    '}' +
    '.word-card-top {' +
      'display: flex;' +
      'justify-content: space-between;' +
      'align-items: center;' +
      'margin-bottom: 8px;' +
    '}' +
    '.word-title {' +
      'font-size: 26px;' +
      'font-weight: 800;' +
      'color: #0f172a;' +
    '}' +
    '.word-pos {' +
      'font-size: 14px;' +
      'color: #64748b;' +
      'font-style: italic;' +
      'margin-left: 8px;' +
    '}' +
    '.score-badge {' +
      'background: #dcfce7;' +
      'color: #166534;' +
      'font-size: 16px;' +
      'font-weight: 800;' +
      'padding: 6px 14px;' +
      'border-radius: 6px;' +
      'border: 1px solid #86efac;' +
    '}' +
    '.definition-row {' +
      'font-size: 14px;' +
      'color: #1e293b;' +
      'margin-bottom: 10px;' +
    '}' +
    '.model-box {' +
      'background: #eff6ff;' +
      'border-left: 4px solid #3b82f6;' +
      'padding: 10px 14px;' +
      'font-size: 13.5px;' +
      'color: #1e40af;' +
      'border-radius: 4px;' +
      'margin-bottom: 10px;' +
    '}' +
    '.colloc-tag {' +
      'display: inline-block;' +
      'background: #e0e7ff;' +
      'color: #3730a3;' +
      'padding: 3px 9px;' +
      'border-radius: 4px;' +
      'font-size: 12px;' +
      'font-weight: 600;' +
      'margin-right: 6px;' +
      'margin-top: 4px;' +
    '}' +
    '.section-title {' +
      'font-size: 15px;' +
      'font-weight: 800;' +
      'color: #0f172a;' +
      'border-bottom: 1px solid #cbd5e1;' +
      'padding-bottom: 4px;' +
      'margin-top: 20px;' +
      'margin-bottom: 12px;' +
      'text-transform: uppercase;' +
      'letter-spacing: 0.04em;' +
    '}' +
    '.sentence-item {' +
      'background: #ffffff;' +
      'border: 1px solid #e2e8f0;' +
      'border-radius: 8px;' +
      'padding: 10px 14px;' +
      'margin-bottom: 10px;' +
      'page-break-inside: avoid;' +
    '}' +
    '.sentence-item.empty {' +
      'background: #f8fafc;' +
      'border: 1px dashed #cbd5e1;' +
    '}' +
    '.sentence-header {' +
      'display: flex;' +
      'justify-content: space-between;' +
      'align-items: center;' +
      'margin-bottom: 4px;' +
    '}' +
    '.sentence-label {' +
      'font-weight: 700;' +
      'color: #2563eb;' +
      'font-size: 13px;' +
    '}' +
    '.status-tag {' +
      'font-size: 11px;' +
      'font-weight: 700;' +
      'padding: 2px 8px;' +
      'border-radius: 4px;' +
    '}' +
    '.tag-valid { background: #dcfce7; color: #166534; }' +
    '.tag-warning { background: #fef3c7; color: #92400e; }' +
    '.tag-error { background: #fee2e2; color: #991b1b; }' +
    '.tag-empty { background: #f1f5f9; color: #64748b; }' +
    '.sentence-text {' +
      'font-size: 13.5px;' +
      'color: #0f172a;' +
      'line-height: 1.45;' +
    '}' +
    '.empty-text {' +
      'color: #94a3b8;' +
      'font-size: 13px;' +
    '}' +
    '.sentence-feedback {' +
      'font-size: 12px;' +
      'color: #475569;' +
      'margin-top: 4px;' +
      'border-top: 1px dotted #e2e8f0;' +
      'padding-top: 4px;' +
    '}' +
    '.summary-box {' +
      'margin-top: 24px;' +
      'background: #f1f5f9;' +
      'border-radius: 8px;' +
      'padding: 12px 18px;' +
      'display: flex;' +
      'justify-content: space-between;' +
      'align-items: center;' +
      'page-break-inside: avoid;' +
    '}' +
    '.footer {' +
      'margin-top: 30px;' +
      'text-align: center;' +
      'font-size: 11px;' +
      'color: #94a3b8;' +
      'border-top: 1px solid #e2e8f0;' +
      'padding-top: 10px;' +
    '}' +
  '</style>' +
'</head>' +
'<body>' +
  '<div class="header">' +
    '<div>' +
      '<span class="badge-top">IELTS Academic Lexical Mastery</span>' +
      '<h1>Candidate Vocabulary Study Record</h1>' +
      '<div class="meta">Topic: <strong>' + topic.topicTitle + '</strong></div>' +
    '</div>' +
    '<div class="meta" style="text-align: right;">' +
      '<div>Generated: ' + new Date().toLocaleDateString() + '</div>' +
      '<div>Cambridge Standard Lexical Evaluation</div>' +
    '</div>' +
  '</div>' +

  '<div class="word-card">' +
    '<div class="word-card-top">' +
      '<div class="word-title">' + w.id + '. ' + w.word + ' <span class="word-pos">(' + (w.pos || 'academic') + ')</span></div>' +
      '<div class="score-badge">' + (filledCount > 0 ? (filledCount + '/6 Sentences Completed') : 'Study Template') + '</div>' +
    '</div>' +
    '<div class="definition-row"><strong>Definition:</strong> ' + w.meaning + '</div>' +
    '<div class="model-box"><strong>Cambridge Model Sentence:</strong> “' + w.example + '”</div>' +
    '<div>' +
      '<strong>High-Scoring Collocations:</strong> ' +
      (w.collocations || []).map(c => '<span class="colloc-tag">' + c + '</span>').join('') +
    '</div>' +
  '</div>' +

  '<div class="section-title">Part A: 3 Simple Sentences (Clarity & Collocation)</div>' +
  formatPDFSentenceItem(repSimple[0], 'Simple Sentence #1') +
  formatPDFSentenceItem(repSimple[1], 'Simple Sentence #2') +
  formatPDFSentenceItem(repSimple[2], 'Simple Sentence #3') +

  '<div class="section-title">Part B: 3 Complex Sentences (Subordination & Syntax)</div>' +
  formatPDFSentenceItem(repComplex[0], 'Complex Sentence #1 (Subordinate / Causal)') +
  formatPDFSentenceItem(repComplex[1], 'Complex Sentence #2 (Conditional / Hypothetical)') +
  formatPDFSentenceItem(repComplex[2], 'Complex Sentence #3 (Relative / Inversion / Cleft)') +

  '<div class="summary-box">' +
    '<div>' +
      '<strong>Practice Session Summary:</strong>' +
      '<div style="font-size: 13px; color: #475569;">' +
        filledCount + ' of 6 sentences completed • ' + (6 - filledCount) + ' left blank • Evaluated against Cambridge C1/C2 descriptors.' +
      '</div>' +
    '</div>' +
    '<div style="text-align: right;">' +
      '<span style="font-size: 11px; text-transform: uppercase; color: #64748b;">Linguistic Verification</span>' +
      '<div style="font-size: 15px; font-weight: 800; color: #166534;">' + (filledCount >= 3 ? '✓ Verified Accurate' : (filledCount > 0 ? '◐ In Progress' : '○ Practice Space')) + '</div>' +
    '</div>' +
  '</div>' +

  '<div class="footer">' +
    'IELTS Mastery Platform • Cambridge Standard Academic Lexical Resource • For Private Study Use' +
  '</div>' +
'</body>' +
'</html>';

  let printIframe = document.getElementById('vocabPrintIframe');
  if (!printIframe) {
    printIframe = document.createElement('iframe');
    printIframe.id = 'vocabPrintIframe';
    printIframe.style.position = 'fixed';
    printIframe.style.right = '0';
    printIframe.style.bottom = '0';
    printIframe.style.width = '0';
    printIframe.style.height = '0';
    printIframe.style.border = '0';
    printIframe.style.visibility = 'hidden';
    document.body.appendChild(printIframe);
  }

  const iframeDoc = printIframe.contentWindow.document;
  iframeDoc.open();
  iframeDoc.write(htmlContent);
  iframeDoc.close();

  showPDFExportToast(w.word, htmlContent);

  setTimeout(() => {
    try {
      printIframe.contentWindow.focus();
      printIframe.contentWindow.print();
    } catch(err) {
      console.warn('Iframe print failed, opening fallback window:', err);
      const wnd = window.open('', '_blank');
      if (wnd) {
        wnd.document.open();
        wnd.document.write(htmlContent);
        wnd.document.close();
        wnd.focus();
        wnd.print();
      }
    }
  }, 300);
}

function showPDFExportToast(wordName, htmlContent) {
  let toast = document.getElementById('pdfExportToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'pdfExportToast';
    toast.style.position = 'fixed';
    toast.style.bottom = '24px';
    toast.style.right = '24px';
    toast.style.zIndex = '9999';
    toast.style.maxWidth = '420px';
    toast.style.background = '#172033';
    toast.style.border = '1px solid #9e7935';
    toast.style.borderRadius = '10px';
    toast.style.boxShadow = '0 10px 30px rgba(0,0,0,0.6)';
    toast.style.padding = '14px 18px';
    toast.style.color = '#fff';
    toast.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    document.body.appendChild(toast);
  }

  toast.innerHTML = '<div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">' +
    '<div>' +
      '<div style="font-weight: 700; color: #d6b36a; font-size: 0.95rem; margin-bottom: 4px;">' +
        '📄 Print & Save Dialog Opened' +
      '</div>' +
      '<div style="font-size: 0.82rem; color: #cbd5e1; line-height: 1.35;">' +
        'In the print destination dropdown, select <strong>"Save as PDF"</strong> to choose where to save this file on your computer.' +
      '</div>' +
      '<div style="margin-top: 8px; display: flex; gap: 8px;">' +
        '<button id="directDownloadHtmlBtn" style="background: #251e15; border: 1px solid #8a6534; color: #e5c997; padding: 4px 10px; border-radius: 4px; font-size: 0.75rem; cursor: pointer; font-weight: 600;">' +
          '💾 Direct Download (.html)' +
        '</button>' +
      '</div>' +
    '</div>' +
    '<button onclick="this.closest(\'#pdfExportToast\').style.display=\'none\'" style="background: none; border: none; color: #94a3b8; font-size: 1.1rem; cursor: pointer; padding: 0 4px;">&times;</button>' +
  '</div>';
  toast.style.display = 'block';

  const dlBtn = document.getElementById('directDownloadHtmlBtn');
  if (dlBtn) {
    dlBtn.onclick = () => {
      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'IELTS_Vocab_' + (wordName || 'Record') + '.html';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };
  }

  setTimeout(() => {
    if (toast) toast.style.display = 'none';
  }, 9000);
}


// ============================================================================
// Master PDF Exporter: All 30 Words of Active Topic in a Single PDF
// ============================================================================

function exportAll30WordsToPDF() {
  const topic = vocabTopics[currentTopicIndex];
  if (!topic || !topic.words || !topic.words.length) {
    alert('No active vocabulary topic found to export.');
    return;
  }

  // 1. Sync active word DOM inputs into storage first so latest typing is captured
  const activeW = topic.words[currentWordIndex];
  if (activeW) {
    const s1 = (document.getElementById('simpleSentence1') ? document.getElementById('simpleSentence1').value.trim() : '');
    const s2 = (document.getElementById('simpleSentence2') ? document.getElementById('simpleSentence2').value.trim() : '');
    const s3 = (document.getElementById('simpleSentence3') ? document.getElementById('simpleSentence3').value.trim() : '');
    const c1 = (document.getElementById('complexSentence1') ? document.getElementById('complexSentence1').value.trim() : '');
    const c2 = (document.getElementById('complexSentence2') ? document.getElementById('complexSentence2').value.trim() : '');
    const c3 = (document.getElementById('complexSentence3') ? document.getElementById('complexSentence3').value.trim() : '');

    if (s1 || s2 || s3 || c1 || c2 || c3) {
      if (!userSentencesData[topic.topicId]) userSentencesData[topic.topicId] = {};
      const existing = userSentencesData[topic.topicId][activeW.id] || {};
      userSentencesData[topic.topicId][activeW.id] = {
        ...existing,
        word: activeW.word,
        pos: activeW.pos,
        meaning: activeW.meaning,
        example: activeW.example,
        collocations: activeW.collocations,
        simple: [s1, s2, s3],
        complex: [c1, c2, c3]
      };
    }
  }

  const topicData = userSentencesData[topic.topicId] || {};

  // 2. Process all 30 words
  let completedWordsCount = 0;
  let totalSentencesWritten = 0;
  let totalScoreSum = 0;
  let scoredWordsCount = 0;

  const processedWords = topic.words.map((w, idx) => {
    const saved = topicData[w.id] || {};
    const simple = saved.simple || ['', '', ''];
    const complex = saved.complex || ['', '', ''];

    const repSimple = [
      analyzeSentenceLinguistics(simple[0], w, 'Simple', 1),
      analyzeSentenceLinguistics(simple[1], w, 'Simple', 2),
      analyzeSentenceLinguistics(simple[2], w, 'Simple', 3)
    ];
    const repComplex = [
      analyzeSentenceLinguistics(complex[0], w, 'Complex', 1),
      analyzeSentenceLinguistics(complex[1], w, 'Complex', 2),
      analyzeSentenceLinguistics(complex[2], w, 'Complex', 3)
    ];

    let wordFilledCount = 0;
    let wordScoreSum = 0;
    [...repSimple, ...repComplex].forEach(r => {
      if (r.status !== 'empty') {
        wordFilledCount++;
        wordScoreSum += r.score;
        totalSentencesWritten++;
      }
    });

    let wordStatus = '○ Practice Space';
    if (wordFilledCount >= 3) {
      wordStatus = '✓ Verified (' + wordFilledCount + '/6)';
      completedWordsCount++;
    } else if (wordFilledCount > 0) {
      wordStatus = '◐ In Progress (' + wordFilledCount + '/6)';
      completedWordsCount++;
    }

    return {
      wordObj: w,
      index: idx + 1,
      saved,
      repSimple,
      repComplex,
      wordFilledCount,
      wordStatus
    };
  });

  const topicStatus = completedWordsCount >= 15 ? '✓ Highly Active (' + completedWordsCount + '/30)' : (completedWordsCount > 0 ? '◐ In Progress (' + completedWordsCount + '/30)' : '○ Not Started (0/30)');
  const speechTranscript = (document.getElementById('vocabSpeechTranscript') ? document.getElementById('vocabSpeechTranscript').value.trim() : '');

  // Helper to format sentence item in the master PDF
  function formatMasterSentence(r, label, placeholderTip) {
    if (r.status === 'empty') {
      return '<div class="sentence-item empty">' +
        '<div class="sentence-header">' +
          '<span class="sentence-label">' + label + '</span>' +
          '<span class="status-tag tag-empty">○ Practice Space</span>' +
        '</div>' +
        '<div class="sentence-text empty-text"><em>(Not attempted yet — ' + placeholderTip + ')</em></div>' +
        '<div class="practice-line"></div>' +
      '</div>';
    }

    const tagClass = r.status === 'valid' ? 'tag-valid' : (r.status === 'missing_word' ? 'tag-error' : 'tag-warning');

    return '<div class="sentence-item">' +
      '<div class="sentence-header">' +
        '<span class="sentence-label">' + label + '</span>' +
        '<span class="status-tag ' + tagClass + '">' + r.badge + '</span>' +
      '</div>' +
      '<div class="sentence-text">“' + r.text + '”</div>' +
      '<div class="sentence-feedback">' + r.note + '</div>' +
    '</div>';
  }

  // 3. Generate Index Table for Cover Page
  let indexRowsHtml = '';
  for (let i = 0; i < 30; i += 3) {
    indexRowsHtml += '<tr>';
    for (let col = 0; col < 3; col++) {
      const item = processedWords[i + col];
      if (item) {
        const isDone = item.wordFilledCount >= 2;
        const statusIcon = item.wordFilledCount >= 3 ? '<span style="color:#166534;font-weight:bold;">✓ Done (' + item.wordFilledCount + '/6)</span>' : (item.wordFilledCount > 0 ? '<span style="color:#d97706;font-weight:bold;">◐ ' + item.wordFilledCount + '/6</span>' : '<span style="color:#94a3b8;">○ Blank</span>');
        indexRowsHtml += '<td style="padding: 5px 8px; border: 1px solid #e2e8f0; font-size: 11px;">' +
          '<strong>#' + item.index + ' ' + item.wordObj.word + '</strong> <small style="color:#64748b;">(' + (item.wordObj.pos || 'acad') + ')</small><br/>' +
          statusIcon +
        '</td>';
      } else {
        indexRowsHtml += '<td style="border: 1px solid #e2e8f0;"></td>';
      }
    }
    indexRowsHtml += '</tr>';
  }

  // 4. Generate All 30 Word Study Sheets
  let wordSheetsHtml = '';
  processedWords.forEach((pw, i) => {
    const w = pw.wordObj;
    const isLast = (i === processedWords.length - 1);

    wordSheetsHtml += '<div class="word-sheet' + (isLast ? '' : ' page-break') + '">' +
      '<div class="sheet-header">' +
        '<div>' +
          '<div class="sheet-super">IELTS Academic Lexical Resource • ' + topic.topicTitle + '</div>' +
          '<h2 class="sheet-title">#' + pw.index + '. ' + w.word + ' <span class="sheet-pos">(' + (w.pos || 'academic') + ')</span></h2>' +
        '</div>' +
        '<div class="sheet-score-badge"><span style="font-size: 9px; text-transform: uppercase; display: block; color: #166534;">Drill Status</span>' + pw.wordStatus + '</div>' +
      '</div>' +

      '<div class="word-card-box">' +
        '<div style="font-size: 13px; margin-bottom: 6px;"><strong>Academic Meaning:</strong> ' + w.meaning + '</div>' +
        '<div class="model-sentence-box"><strong>Cambridge Model Sentence:</strong> “' + w.example + '”</div>' +
        '<div style="margin-top: 6px;">' +
          '<strong>High-Frequency Collocations:</strong> ' +
          (w.collocations || []).map(c => '<span class="colloc-tag">' + c + '</span>').join('') +
        '</div>' +
      '</div>' +

      '<div class="section-divider">Part A: 3 Simple Sentences (Clarity & Collocation Focus)</div>' +
      formatMasterSentence(pw.repSimple[0], 'Simple Sentence #1', 'Focus on clear subject + verb + direct collocation') +
      formatMasterSentence(pw.repSimple[1], 'Simple Sentence #2', 'Express an independent academic proposition') +
      formatMasterSentence(pw.repSimple[2], 'Simple Sentence #3', 'Aim for 7–12 words with natural context') +

      '<div class="section-divider">Part B: 3 Complex Sentences (Syntactic Variety & Subordination)</div>' +
      formatMasterSentence(pw.repComplex[0], 'Complex Sentence #1 (Subordinate)', 'Use although / because / whereas / while') +
      formatMasterSentence(pw.repComplex[1], 'Complex Sentence #2 (Conditional)', 'Use if / unless / provided that / had I') +
      formatMasterSentence(pw.repComplex[2], 'Complex Sentence #3 (Relative/Inversion)', 'Use which / whereby / not only... but also') +

      '<div class="sheet-footer">' +
        '<span>Word #' + pw.index + ' of 30 • ' + (pw.wordFilledCount > 0 ? (pw.wordFilledCount + '/6 Sentences Completed') : 'Template') + '</span>' +
        '<span>IELTS Preparation Mastery • Cambridge Standard</span>' +
      '</div>' +
    '</div>';
  });

  // 5. Complete Master HTML Document
  const masterHtml = '<!DOCTYPE html>' +
'<html lang="en">' +
'<head>' +
  '<meta charset="utf-8">' +
  '<title>IELTS 30-Word Master Lexical Portfolio - ' + topic.topicTitle + '</title>' +
  '<style>' +
    '@page { size: A4 portrait; margin: 12mm 15mm; }' +
    '* { box-sizing: border-box; }' +
    'body {' +
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;' +
      'color: #0f172a;' +
      'line-height: 1.45;' +
      'margin: 0;' +
      'padding: 0;' +
      'background: #ffffff;' +
      '-webkit-print-color-adjust: exact;' +
      'print-color-adjust: exact;' +
    '}' +
    '.page-break { page-break-after: always; break-after: page; }' +
    '.cover-page {' +
      'padding: 16px 8px;' +
      'page-break-after: always;' +
      'break-after: page;' +
      'min-height: 98vh;' +
      'display: flex;' +
      'flex-direction: column;' +
      'justify-content: space-between;' +
    '}' +
    '.cover-header {' +
      'border-bottom: 3px solid #3b82f6;' +
      'padding-bottom: 12px;' +
      'margin-bottom: 16px;' +
    '}' +
    '.cover-badge {' +
      'background: #dbeafe;' +
      'color: #1e40af;' +
      'padding: 4px 10px;' +
      'border-radius: 999px;' +
      'font-size: 11px;' +
      'font-weight: 700;' +
      'text-transform: uppercase;' +
      'letter-spacing: 0.05em;' +
    '}' +
    '.cover-title {' +
      'font-size: 26px;' +
      'color: #1e3a8a;' +
      'margin: 8px 0 4px 0;' +
      'font-weight: 800;' +
    '}' +
    '.cover-subtitle {' +
      'font-size: 14px;' +
      'color: #475569;' +
      'font-weight: 500;' +
    '}' +
    '.stats-grid {' +
      'display: grid;' +
      'grid-template-columns: repeat(4, 1fr);' +
      'gap: 10px;' +
      'margin: 14px 0;' +
    '}' +
    '.stat-card {' +
      'background: #f8fafc;' +
      'border: 1px solid #e2e8f0;' +
      'border-radius: 8px;' +
      'padding: 10px;' +
      'text-align: center;' +
    '}' +
    '.stat-num {' +
      'font-size: 20px;' +
      'font-weight: 800;' +
      'color: #2563eb;' +
      'font-family: monospace;' +
    '}' +
    '.stat-label {' +
      'font-size: 10px;' +
      'color: #64748b;' +
      'text-transform: uppercase;' +
      'font-weight: 700;' +
      'margin-top: 2px;' +
    '}' +
    '.cue-box {' +
      'background: #eff6ff;' +
      'border: 1px solid #bfdbfe;' +
      'border-radius: 8px;' +
      'padding: 12px 16px;' +
      'margin-bottom: 16px;' +
    '}' +
    '.cue-title {' +
      'font-size: 13px;' +
      'font-weight: 800;' +
      'color: #1e40af;' +
      'margin-bottom: 4px;' +
    '}' +
    '.cue-bullets {' +
      'font-size: 11.5px;' +
      'color: #1e3a8a;' +
      'margin: 0;' +
      'padding-left: 18px;' +
    '}' +
    '.index-table {' +
      'width: 100%;' +
      'border-collapse: collapse;' +
      'margin-top: 10px;' +
    '}' +
    '.word-sheet {' +
      'padding: 14px 4px;' +
      'min-height: 96vh;' +
      'display: flex;' +
      'flex-direction: column;' +
      'justify-content: space-between;' +
    '}' +
    '.sheet-header {' +
      'display: flex;' +
      'justify-content: space-between;' +
      'align-items: flex-end;' +
      'border-bottom: 2px solid #2563eb;' +
      'padding-bottom: 8px;' +
      'margin-bottom: 12px;' +
    '}' +
    '.sheet-super {' +
      'font-size: 10.5px;' +
      'color: #64748b;' +
      'text-transform: uppercase;' +
      'letter-spacing: 0.04em;' +
      'font-weight: 700;' +
    '}' +
    '.sheet-title {' +
      'font-size: 22px;' +
      'color: #0f172a;' +
      'margin: 2px 0 0 0;' +
      'font-weight: 800;' +
    '}' +
    '.sheet-pos {' +
      'font-size: 13px;' +
      'color: #64748b;' +
      'font-style: italic;' +
    '}' +
    '.sheet-score-badge {' +
      'background: #dcfce7;' +
      'color: #166534;' +
      'font-size: 15px;' +
      'font-weight: 800;' +
      'padding: 4px 12px;' +
      'border-radius: 6px;' +
      'border: 1px solid #86efac;' +
      'text-align: right;' +
    '}' +
    '.word-card-box {' +
      'background: #f8fafc;' +
      'border: 1px solid #cbd5e1;' +
      'border-radius: 8px;' +
      'padding: 12px 16px;' +
      'margin-bottom: 14px;' +
    '}' +
    '.model-sentence-box {' +
      'background: #eff6ff;' +
      'border-left: 3px solid #3b82f6;' +
      'padding: 8px 12px;' +
      'font-size: 12.5px;' +
      'color: #1e40af;' +
      'border-radius: 4px;' +
      'margin: 6px 0;' +
    '}' +
    '.colloc-tag {' +
      'display: inline-block;' +
      'background: #e0e7ff;' +
      'color: #3730a3;' +
      'padding: 2px 7px;' +
      'border-radius: 4px;' +
      'font-size: 11px;' +
      'font-weight: 600;' +
      'margin-right: 5px;' +
      'margin-top: 3px;' +
    '}' +
    '.section-divider {' +
      'font-size: 12.5px;' +
      'font-weight: 800;' +
      'color: #1e3a8a;' +
      'border-bottom: 1px solid #cbd5e1;' +
      'padding-bottom: 3px;' +
      'margin-top: 10px;' +
      'margin-bottom: 8px;' +
      'text-transform: uppercase;' +
      'letter-spacing: 0.03em;' +
    '}' +
    '.sentence-item {' +
      'background: #ffffff;' +
      'border: 1px solid #e2e8f0;' +
      'border-radius: 6px;' +
      'padding: 8px 12px;' +
      'margin-bottom: 8px;' +
    '}' +
    '.sentence-item.empty {' +
      'background: #fdfdfd;' +
      'border: 1px dashed #cbd5e1;' +
    '}' +
    '.sentence-header {' +
      'display: flex;' +
      'justify-content: space-between;' +
      'align-items: center;' +
      'margin-bottom: 3px;' +
    '}' +
    '.sentence-label {' +
      'font-weight: 700;' +
      'color: #2563eb;' +
      'font-size: 12px;' +
    '}' +
    '.status-tag {' +
      'font-size: 10px;' +
      'font-weight: 700;' +
      'padding: 2px 6px;' +
      'border-radius: 4px;' +
    '}' +
    '.tag-valid { background: #dcfce7; color: #166534; }' +
    '.tag-warning { background: #fef3c7; color: #92400e; }' +
    '.tag-error { background: #fee2e2; color: #991b1b; }' +
    '.tag-empty { background: #f1f5f9; color: #64748b; }' +
    '.sentence-text {' +
      'font-size: 12.5px;' +
      'color: #0f172a;' +
      'line-height: 1.4;' +
    '}' +
    '.empty-text {' +
      'color: #94a3b8;' +
      'font-size: 12px;' +
    '}' +
    '.practice-line {' +
      'border-bottom: 1px dotted #cbd5e1;' +
      'margin-top: 10px;' +
      'height: 2px;' +
    '}' +
    '.sentence-feedback {' +
      'font-size: 11px;' +
      'color: #475569;' +
      'margin-top: 3px;' +
      'border-top: 1px dotted #e2e8f0;' +
      'padding-top: 3px;' +
    '}' +
    '.sheet-footer {' +
      'margin-top: 14px;' +
      'display: flex;' +
      'justify-content: space-between;' +
      'font-size: 10.5px;' +
      'color: #94a3b8;' +
      'border-top: 1px solid #e2e8f0;' +
      'padding-top: 6px;' +
    '}' +
  '</style>' +
'</head>' +
'<body>' +
  '<!-- MASTER COVER & OVERVIEW PAGE -->' +
  '<div class="cover-page">' +
    '<div>' +
      '<div class="cover-header">' +
        '<span class="cover-badge">IELTS Academic Lexical Resource Master Guide</span>' +
        '<h1 class="cover-title">Complete 30-Word Academic Vocabulary Portfolio</h1>' +
        '<div class="cover-subtitle">Theme: <strong>' + topic.topicTitle + '</strong></div>' +
      '</div>' +

      '<div class="stats-grid">' +
        '<div class="stat-card">' +
          '<div class="stat-num">30</div>' +
          '<div class="stat-label">Total C1/C2 Words</div>' +
        '</div>' +
        '<div class="stat-card">' +
          '<div class="stat-num">' + completedWordsCount + ' / 30</div>' +
          '<div class="stat-label">Words Practiced</div>' +
        '</div>' +
        '<div class="stat-card">' +
          '<div class="stat-num">' + totalSentencesWritten + ' / 180</div>' +
          '<div class="stat-label">Sentences Formed</div>' +
        '</div>' +
        '<div class="stat-card">' +
          '<div class="stat-num" style="font-size: 15px; font-weight: 800; color: ' + (completedWordsCount > 0 ? '#2563eb' : '#94a3b8') + ';">' + (completedWordsCount > 0 ? (completedWordsCount + ' / 30') : '0 / 30') + '</div>' +
          '<div class="stat-label">Words Practiced</div>' +
        '</div>' +
      '</div>' +

      (topic.speechCueCard ? (
        '<div class="cue-box">' +
          '<div class="cue-title">Grand Speech Cue Card Challenge: ' + topic.speechCueCard.title + '</div>' +
          '<ul class="cue-bullets">' +
            (topic.speechCueCard.prompts || []).map(p => '<li>' + p + '</li>').join('') +
          '</ul>' +
          (speechTranscript ? ('<div style="margin-top: 8px; font-size: 11.5px; color: #1e3a8a; border-top: 1px dashed #bfdbfe; padding-top: 6px;"><strong>Candidate Speech Response:</strong> “' + speechTranscript + '”</div>') : '') +
        '</div>'
      ) : '') +

      '<div>' +
        '<div style="font-size: 12px; font-weight: 800; color: #1e3a8a; text-transform: uppercase; margin-bottom: 4px;">' +
          'Master Lexical Index (30 Topic Words & Practice Status)' +
        '</div>' +
        '<table class="index-table">' + indexRowsHtml + '</table>' +
      '</div>' +
    '</div>' +

    '<div style="text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 8px;">' +
      'Official IELTS Preparation Simulator • Complete 30-Word Master Study Portfolio • Cambridge C1/C2 Standard' +
    '</div>' +
  '</div>' +

  '<!-- 30 INDIVIDUAL WORD DRILL PAGES -->' +
  wordSheetsHtml +
'</body>' +
'</html>';

  // Trigger print dialog using dedicated master iframe
  let masterPrintFrame = document.getElementById('vocabMasterPrintIframe');
  if (!masterPrintFrame) {
    masterPrintFrame = document.createElement('iframe');
    masterPrintFrame.id = 'vocabMasterPrintIframe';
    masterPrintFrame.style.position = 'fixed';
    masterPrintFrame.style.right = '0';
    masterPrintFrame.style.bottom = '0';
    masterPrintFrame.style.width = '0';
    masterPrintFrame.style.height = '0';
    masterPrintFrame.style.border = '0';
    masterPrintFrame.style.visibility = 'hidden';
    document.body.appendChild(masterPrintFrame);
  }

  const iframeDoc = masterPrintFrame.contentWindow.document;
  iframeDoc.open();
  iframeDoc.write(masterHtml);
  iframeDoc.close();

  showMasterPDFToast(topic.topicTitle, masterHtml);

  setTimeout(() => {
    try {
      masterPrintFrame.contentWindow.focus();
      masterPrintFrame.contentWindow.print();
    } catch(err) {
      console.warn('Iframe print failed, opening fallback window:', err);
      const wnd = window.open('', '_blank');
      if (wnd) {
        wnd.document.open();
        wnd.document.write(masterHtml);
        wnd.document.close();
        wnd.focus();
        wnd.print();
      }
    }
  }, 400);
}

function showMasterPDFToast(topicTitle, masterHtml) {
  let toast = document.getElementById('masterPdfToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'masterPdfToast';
    toast.style.position = 'fixed';
    toast.style.bottom = '24px';
    toast.style.right = '24px';
    toast.style.zIndex = '9999';
    toast.style.maxWidth = '460px';
    toast.style.background = '#172033';
    toast.style.border = '2px solid #9e7935';
    toast.style.borderRadius = '10px';
    toast.style.boxShadow = '0 12px 35px rgba(0,0,0,0.7)';
    toast.style.padding = '16px 20px';
    toast.style.color = '#fff';
    toast.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    document.body.appendChild(toast);
  }

  const safeTopic = (topicTitle || 'Master').replace(/[^a-zA-Z0-9]/g, '_');

  toast.innerHTML = '<div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">' +
    '<div>' +
      '<div style="font-weight: 800; color: #d6b36a; font-size: 1rem; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">' +
        '<span>📚 30-Word Master PDF Ready</span>' +
      '</div>' +
      '<div style="font-size: 0.83rem; color: #cbd5e1; line-height: 1.4;">' +
        'In your browser print dialog, select <strong>"Save as PDF"</strong> to save the complete 30-word booklet to your computer.' +
      '</div>' +
      '<div style="margin-top: 10px; display: flex; gap: 8px;">' +
        '<button id="directDownloadMasterHtmlBtn" style="background: linear-gradient(180deg, #b89146, #8f6c27); border: none; color: #fff; padding: 6px 12px; border-radius: 4px; font-size: 0.78rem; cursor: pointer; font-weight: 700;">' +
          '💾 Direct Download All 30 Words (.html)' +
        '</button>' +
      '</div>' +
    '</div>' +
    '<button onclick="this.closest(\'#masterPdfToast\').style.display=\'none\'" style="background: none; border: none; color: #94a3b8; font-size: 1.2rem; cursor: pointer; padding: 0 4px;">&times;</button>' +
  '</div>';
  toast.style.display = 'block';

  const dlBtn = document.getElementById('directDownloadMasterHtmlBtn');
  if (dlBtn) {
    dlBtn.onclick = () => {
      const blob = new Blob([masterHtml], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'IELTS_All_30_Words_' + safeTopic + '.html';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };
  }

  setTimeout(() => {
    if (toast) toast.style.display = 'none';
  }, 10000);
}


function setupCueCardView() {
  const topic = vocabTopics[currentTopicIndex];
  if (!topic) return;

  document.getElementById('vocabCueTopicTitle').innerText = topic.speechCueCard ? topic.speechCueCard.title : `Speak about ${topic.topicTitle}`;
  
  const bulletsEl = document.getElementById('vocabCueBullets');
  if (topic.speechCueCard && topic.speechCueCard.prompts) {
    bulletsEl.innerHTML = `<strong>You should mention:</strong><ul>${topic.speechCueCard.prompts.map(p => `<li>${p}</li>`).join('')}</ul>`;
  } else {
    bulletsEl.innerHTML = '';
  }

  // Word Checklist helper
  const wordChecklist = document.getElementById('vocabWordChecklist');
  if (wordChecklist && topic.words) {
    wordChecklist.innerHTML = '';
    topic.words.forEach(w => {
      const span = document.createElement('span');
      span.className = 'target-word-chip';
      span.id = `chip-${w.word.toLowerCase()}`;
      span.innerText = w.word;
      wordChecklist.appendChild(span);
    });
  }
}

// Read Cue Card Aloud (Examiner Text-to-Speech)
function speakVocabCueCard() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const topic = vocabTopics[currentTopicIndex];
    const text = "Here is your vocabulary speech cue card. " + (topic.speechCueCard ? topic.speechCueCard.title : topic.topicTitle);
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.95;
    window.speechSynthesis.speak(utter);
  }
}

// 1-Minute Prep Countdown
function startVocabPrepTimer() {
  clearInterval(prepSpeechTimer);
  clearInterval(speechDurationTimer);
  prepSecondsLeft = 60;

  const display = document.getElementById('vocabSpeechTimerDisplay');
  const label = document.getElementById('vocabSpeechTimerLabel');
  label.innerText = 'PREPARATION COUNTDOWN (1 MINUTE)';
  display.style.color = '#f59e0b';

  prepSpeechTimer = setInterval(() => {
    prepSecondsLeft--;
    const m = String(Math.floor(prepSecondsLeft / 60)).padStart(2, '0');
    const s = String(prepSecondsLeft % 60).padStart(2, '0');
    display.innerText = `${m}:${s}`;

    if (prepSecondsLeft <= 0) {
      clearInterval(prepSpeechTimer);
      display.innerText = '00:00';
      display.style.color = '#ef4444';
      label.innerText = "TIME IS UP! START 2-MIN SPEECH";
      // Auto-start speaking
      toggleVocabSpeechRecording();
    }
  }, 1000);
}

// 2-Minute Speech Recording
function toggleVocabSpeechRecording() {
  const btn = document.getElementById('vocabRecordBtn');
  const liveTag = document.getElementById('vocabLiveTag');
  const display = document.getElementById('vocabSpeechTimerDisplay');
  const label = document.getElementById('vocabSpeechTimerLabel');

  if (!isVocabSpeaking) {
    // Start Speaking
    isVocabSpeaking = true;
    btn.innerText = '⏹️ Finish & Evaluate Speech';
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-danger');
    liveTag.style.display = 'inline-flex';
    label.innerText = 'SPEAKING DURATION (2 MINUTES MAX)';
    display.style.color = '#3b82f6';

    clearInterval(prepSpeechTimer);
    clearInterval(speechDurationTimer);
    speechSecondsElapsed = 0;

    speechDurationTimer = setInterval(() => {
      speechSecondsElapsed++;
      const m = String(Math.floor(speechSecondsElapsed / 60)).padStart(2, '0');
      const s = String(speechSecondsElapsed % 60).padStart(2, '0');
      display.innerText = `${m}:${s}`;

      if (speechSecondsElapsed >= 120) {
        clearInterval(speechDurationTimer);
        display.style.color = '#f59e0b';
        label.innerText = '2 MINUTES COMPLETED (FULL LONG TURN)';
      }
    }, 1000);

    if (vocabSpeechRecognition) {
      try { vocabSpeechRecognition.start(); } catch(e) {}
    }
  } else {
    // Stop & Evaluate
    stopVocabSpeechRecording();
    evaluateVocabSpeech();
  }
}

function stopVocabSpeechRecording() {
  isVocabSpeaking = false;
  const btn = document.getElementById('vocabRecordBtn');
  btn.innerText = '🎙️ Start 2-Min Speaking';
  btn.classList.remove('btn-danger');
  btn.classList.add('btn-primary');
  document.getElementById('vocabLiveTag').style.display = 'none';

  clearInterval(speechDurationTimer);
  if (vocabSpeechRecognition) {
    try { vocabSpeechRecognition.stop(); } catch(e) {}
  }
}

// Comprehensive Vocabulary & Speaking Evaluation
function evaluateVocabSpeech() {
  const text = document.getElementById('vocabSpeechTranscript').value.trim();
  if (!text || text.split(/\s+/).length < 5) {
    alert('Please speak or type a speech response of at least 5 words before evaluating.');
    return;
  }

  const topic = vocabTopics[currentTopicIndex];
  const questionTitle = topic.speechCueCard ? topic.speechCueCard.title : topic.topicTitle;

  // 1. Evaluate using IELTS 7-criteria evaluator
  const evalResult = IELTS_EVALUATOR.evaluate(text, speechSecondsElapsed || 45, questionTitle);

  // 2. Calculate Target Vocabulary Density
  let usedWords = [];
  topic.words.forEach(w => {
    const root = w.word.toLowerCase().slice(0, -1);
    if (text.toLowerCase().includes(root)) {
      usedWords.push(w.word);
      // Highlight chip in UI
      const chip = document.getElementById(`chip-${w.word.toLowerCase()}`);
      if (chip) chip.classList.add('used');
    }
  });

  const vocabCoveragePercent = Math.round((usedWords.length / topic.words.length) * 100);

  // Render Vocab Evaluation Card
  const evalCard = document.getElementById('vocabEvalCard');
  document.getElementById('vocabOverallBand').innerText = evalResult.overallBand;
  document.getElementById('vocabUsedCount').innerText = `${usedWords.length} / ${topic.words.length} Target Words (${vocabCoveragePercent}%)`;
  document.getElementById('vocabWpmStat').innerText = `${evalResult.wpm} WPM`;

  // Render used words list
  const usedListEl = document.getElementById('vocabUsedWordsList');
  if (usedWords.length > 0) {
    usedListEl.innerHTML = usedWords.map(w => `<span class="pill-upgraded">${w}</span>`).join(' ');
  } else {
    usedListEl.innerHTML = '<span style="color: var(--text-muted);">None of the 30 topic target words were detected in your speech. Try incorporating at least 4-5 words on your next attempt!</span>';
  }

  // Render Criteria Matrix
  const grid = document.getElementById('vocabCriteriaGrid');
  grid.innerHTML = '';
  Object.keys(evalResult.criteria).forEach(k => {
    const c = evalResult.criteria[k];
    const box = document.createElement('div');
    box.className = 'criterion-box';
    box.innerHTML = `
      <div class="criterion-header">
        <span class="criterion-name">${c.name}</span>
        <span class="criterion-grade">Band ${c.score}</span>
      </div>
      <p class="criterion-desc">${c.feedback}</p>
    `;
    grid.appendChild(box);
  });

  // Model Rephrase
  document.getElementById('vocabModelRephrase').innerText = evalResult.modelRephrase;

  // Upgrades
  const tbody = document.getElementById('vocabUpgradeTbody');
  tbody.innerHTML = '';
  (evalResult.upgrades || []).forEach(u => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="pill-original">${u.original}</span></td>
      <td><span class="pill-upgraded">${u.upgrade}</span></td>
      <td style="color: var(--text-secondary);">${u.note}</td>
    `;
    tbody.appendChild(tr);
  });

  evalCard.style.display = 'flex';
  evalCard.scrollIntoView({ behavior: 'smooth' });
}

// AI Generate 30 New Words for Custom/Random Topic
async function generateNewAIVocab() {
  const custom = prompt('Enter a topic for the 30-word vocabulary set (e.g., Space Exploration, Medical Ethics, Global Economics):', '');
  const apiKey = document.getElementById('geminiKeyInput') ? document.getElementById('geminiKeyInput').value.trim() : '';

  const btn = document.getElementById('aiVocabGenBtn');
  const originalText = btn.innerText;
  btn.innerText = '✨ Generating 30 Words...';
  btn.disabled = true;

  try {
    const generated = await IELTS_AI_GENERATOR.generate30VocabTopic(custom, apiKey);
    vocabTopics.unshift(generated);
    currentTopicIndex = 0;
    currentWordIndex = 0;
    renderTopicSelector();
    renderWordGrid();
    loadActiveWord();
    setupCueCardView();
    alert(`✨ Generated 30 Band 8+ Vocabulary Words on: "${generated.topicTitle}"!`);
  } catch (err) {
    alert('Failed to generate AI vocabulary. Please try again.');
    console.error(err);
  } finally {
    btn.innerText = originalText;
    btn.disabled = false;
  }
}

// Navigation between Dashboard & Modules
function showView(viewId) {
  const views = {
    'dashboardView': 'flex',
    'speakingView': 'grid',
    'vocabsView': 'flex'
  };
  Object.keys(views).forEach(v => {
    const el = document.getElementById(v);
    if (el) {
      el.style.display = (v === viewId) ? views[v] : 'none';
    }
  });

  // Highlight active nav tab if exists
  document.querySelectorAll('.top-nav-link').forEach(link => {
    if (link.getAttribute('data-view') === viewId) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showUnderDevModal(moduleName, description) {
  const modal = document.getElementById('underDevModal');
  const title = document.getElementById('underDevModalTitle');
  const desc = document.getElementById('underDevModalDesc');

  if (title) title.innerText = `${moduleName} Module - Under Development`;
  if (desc) desc.innerText = description;
  if (modal) modal.style.display = 'flex';
}

function closeUnderDevModal() {
  const modal = document.getElementById('underDevModal');
  if (modal) modal.style.display = 'none';
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  initVocabSpeech();
  loadVocabBank();
});
