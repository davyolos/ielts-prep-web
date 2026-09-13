// ============================================================================
// IELTS Speaking Mastery - Main Application Logic (Vercel & AI Enhanced)
// ============================================================================

let questionsData = { part1: [], part2: [], part3: [] };
let activePhase = 'part1';
let currentQuestionIndex = 0;
let currentFilter = 'all'; // 'all', 'real', 'ai'
let recognition = null;
let isRecording = false;
let timerInterval = null;
let prepTimerInterval = null;
let secondsSpoken = 0;

// Initialize Web Speech Recognition
function initSpeechEngine() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let accumulatedText = '';
      for (let i = 0; i < event.results.length; i++) {
        accumulatedText += event.results[i][0].transcript + ' ';
      }
      document.getElementById('speechTranscript').value = accumulatedText.trim();
    };

    recognition.onerror = (err) => {
      console.warn('Speech recognition warning:', err.error);
      if (err.error === 'not-allowed') {
        alert('Microphone access was denied. Please allow microphone permissions in your browser address bar.');
        stopSpeechRecording();
      }
    };

    recognition.onend = () => {
      if (isRecording) {
        try { recognition.start(); } catch (e) {}
      }
    };
  } else {
    console.warn('Web Speech API not supported in this browser. Manual typing mode active.');
  }
}

// Fetch Questions (From API or Fallback)
async function fetchQuestions() {
  try {
    const res = await fetch('/api/questions');
    if (res.ok) {
      questionsData = await res.json();
    }
  } catch (err) {
    console.warn('Could not fetch questions from server, using built-in cache.', err);
  }
  renderTopicList();
  displayActiveQuestion();
}

// Filter Questions (All, Real Exams, AI Generated)
function setFilter(filterType) {
  currentFilter = filterType;
  currentQuestionIndex = 0;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  const activeChip = document.getElementById(`filter-${filterType}`);
  if (activeChip) activeChip.classList.add('active');
  renderTopicList();
  displayActiveQuestion();
}

function getFilteredList() {
  const list = questionsData[activePhase] || [];
  if (currentFilter === 'real') {
    return list.filter(q => q.isRealExam);
  } else if (currentFilter === 'ai') {
    return list.filter(q => q.isAIGenerated);
  }
  return list;
}

// Phase Switching (Part 1 / Part 2 / Part 3 / History / Vercel Deploy Guide)
function selectPhase(phaseKey) {
  activePhase = phaseKey;
  currentQuestionIndex = 0;

  document.querySelectorAll('.phase-tab').forEach(tab => tab.classList.remove('active'));
  const clickedTab = document.querySelector(`[data-phase="${phaseKey}"]`);
  if (clickedTab) clickedTab.classList.add('active');

  const stageNormal = document.getElementById('stageNormal');
  const stageHistory = document.getElementById('stageHistory');
  const prepBtn = document.getElementById('prepBtn');
  const scratchpad = document.getElementById('cueScratchpad');
  const phaseBadge = document.getElementById('activePhaseBadge');

  if (phaseKey === 'history') {
    if (stageNormal) stageNormal.style.display = 'none';
    if (stageHistory) stageHistory.style.display = 'flex';
    loadHistorySessions();
    return;
  }

  if (stageNormal) stageNormal.style.display = 'flex';
  if (stageHistory) stageHistory.style.display = 'none';

  if (phaseKey === 'part1') {
    if (phaseBadge) phaseBadge.innerText = 'Part 1: Introduction';
    if (prepBtn) prepBtn.style.display = 'none';
    if (scratchpad) scratchpad.style.display = 'none';
  } else if (phaseKey === 'part2') {
    if (phaseBadge) phaseBadge.innerText = 'Part 2: Cue Card (Long Turn)';
    if (prepBtn) prepBtn.style.display = 'inline-flex';
    if (scratchpad) scratchpad.style.display = 'block';
  } else if (phaseKey === 'part3') {
    if (phaseBadge) phaseBadge.innerText = 'Part 3: Deep Analytical Discussion';
    if (prepBtn) prepBtn.style.display = 'none';
    if (scratchpad) scratchpad.style.display = 'none';
  }

  renderTopicList();
  displayActiveQuestion();
}

// Render Questions List in Sidebar
function renderTopicList() {
  const container = document.getElementById('topicScrollList');
  container.innerHTML = '';
  
  const currentList = getFilteredList();
  document.getElementById('bankCountBadge').innerText = `${currentList.length} Topics`;

  if (currentList.length === 0) {
    container.innerHTML = '<div style="padding: 1rem; color: var(--text-muted); font-size: 0.8rem; text-align: center;">No topics under this filter. Click "AI Generate" to create some!</div>';
    return;
  }

  currentList.forEach((item, idx) => {
    const el = document.createElement('div');
    el.className = `topic-badge-item ${idx === currentQuestionIndex ? 'active' : ''}`;
    
    let tag = '';
    if (item.isRealExam) {
      tag = '<span style="font-size: 0.65rem; background: rgba(59, 130, 246, 0.2); color: #60a5fa; padding: 2px 5px; border-radius: 4px; margin-right: 5px;">REAL</span>';
    } else if (item.isAIGenerated) {
      tag = '<span style="font-size: 0.65rem; background: rgba(84, 144, 196, 0.2); color: #72aae0; padding: 2px 5px; border-radius: 4px; margin-right: 5px; border: 1px solid #2e4f73;">AI</span>';
    }

    el.innerHTML = `${tag}<span>${idx + 1}. ${item.category || 'Topic'}</span>`;
    el.onclick = () => {
      currentQuestionIndex = idx;
      renderTopicList();
      displayActiveQuestion();
    };
    container.appendChild(el);
  });
}

// Display Question on Main Stage
function displayActiveQuestion() {
  resetTimer();
  const currentList = getFilteredList();
  if (!currentList.length) {
    document.getElementById('promptTitle').innerText = "No topics available under current filter. Select 'All' or click 'AI Generate Test' above.";
    document.getElementById('promptBullets').style.display = 'none';
    return;
  }

  const q = currentList[currentQuestionIndex];
  const titleEl = document.getElementById('promptTitle');
  const bulletsEl = document.getElementById('promptBullets');
  const catEl = document.getElementById('categoryLabel');
  const examPill = document.getElementById('realExamPill');

  catEl.innerText = `Topic: ${q.category || 'General'}`;

  if (q.isRealExam) {
    examPill.style.display = 'inline-flex';
    examPill.innerText = `📜 ${q.source || 'Real Exam'}`;
  } else if (q.isAIGenerated) {
    examPill.style.display = 'inline-flex';
    examPill.innerText = '✨ AI Generated';
    examPill.style.color = '#72aae0';
    examPill.style.borderColor = '#3d587c';
  } else {
    examPill.style.display = 'none';
  }

  if (activePhase === 'part2') {
    titleEl.innerText = q.title || q.question;
    bulletsEl.style.display = 'block';
    bulletsEl.innerHTML = `<strong>You should say:</strong><ul>${(q.prompts || []).map(p => `<li>${p}</li>`).join('')}</ul>`;
  } else if (activePhase === 'part3') {
    const listHtml = (q.questions || [q.question]).map(item => `<li>${item}</li>`).join('');
    titleEl.innerText = 'Analytical Discussion Questions:';
    bulletsEl.style.display = 'block';
    bulletsEl.innerHTML = `<ul>${listHtml}</ul>`;
  } else {
    titleEl.innerText = q.question;
    bulletsEl.style.display = 'none';
  }
}

// Next / Previous Navigation
function navigateQuestion(delta) {
  const list = getFilteredList();
  if (!list.length) return;
  currentQuestionIndex = (currentQuestionIndex + delta + list.length) % list.length;
  renderTopicList();
  displayActiveQuestion();
}

// Read Out Loud (Examiner Text-to-Speech)
function speakExaminerQuestion() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    let text = document.getElementById('promptTitle').innerText;
    if (activePhase === 'part2') {
      text = "Here is your cue card topic. " + text;
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.95;
    utter.pitch = 1.0;
    window.speechSynthesis.speak(utter);
  }
}

// 1-Minute Preparation Countdown for Part 2
function triggerPrepTimer() {
  clearInterval(prepTimerInterval);
  resetTimer();
  let remaining = 60;
  const display = document.getElementById('timerReadout');
  const label = document.getElementById('timerLabel');
  label.innerText = 'PREPARATION TIME (1 MINUTE)';
  display.style.color = '#f59e0b';

  prepTimerInterval = setInterval(() => {
    remaining--;
    const m = String(Math.floor(remaining / 60)).padStart(2, '0');
    const s = String(remaining % 60).padStart(2, '0');
    display.innerText = `${m}:${s}`;

    if (remaining <= 0) {
      clearInterval(prepTimerInterval);
      display.innerText = "00:00";
      display.style.color = '#ef4444';
      label.innerText = "TIME UP! COMMENCE SPEAKING";
      toggleSpeechRecording();
    }
  }, 1000);
}

// Toggle Speaking & Recording
function toggleSpeechRecording() {
  const recordBtn = document.getElementById('recordBtn');
  const liveTag = document.getElementById('liveIndicator');
  const display = document.getElementById('timerReadout');
  const label = document.getElementById('timerLabel');

  if (!isRecording) {
    isRecording = true;
    recordBtn.innerText = '⏹️ Finish & Analyze';
    recordBtn.classList.remove('btn-primary');
    recordBtn.classList.add('btn-danger');
    liveTag.style.display = 'inline-flex';
    label.innerText = 'SPEAKING TIMED DURATION';
    display.style.color = '#3b82f6';

    secondsSpoken = 0;
    clearInterval(prepTimerInterval);
    clearInterval(timerInterval);

    timerInterval = setInterval(() => {
      secondsSpoken++;
      const m = String(Math.floor(secondsSpoken / 60)).padStart(2, '0');
      const s = String(secondsSpoken % 60).padStart(2, '0');
      display.innerText = `${m}:${s}`;
    }, 1000);

    if (recognition) {
      try { recognition.start(); } catch (e) {}
    }
  } else {
    stopSpeechRecording();
    performEvaluation();
  }
}

function stopSpeechRecording() {
  isRecording = false;
  const recordBtn = document.getElementById('recordBtn');
  recordBtn.innerText = '🎙️ Start Speaking';
  recordBtn.classList.remove('btn-danger');
  recordBtn.classList.add('btn-primary');
  document.getElementById('liveIndicator').style.display = 'none';

  clearInterval(timerInterval);
  if (recognition) {
    try { recognition.stop(); } catch (e) {}
  }
}

function resetTimer() {
  clearInterval(timerInterval);
  clearInterval(prepTimerInterval);
  secondsSpoken = 0;
  document.getElementById('timerReadout').innerText = '00:00';
  document.getElementById('timerReadout').style.color = 'var(--primary)';
  document.getElementById('timerLabel').innerText = 'SPEAKING TIMER';
}

function clearTranscriptField() {
  document.getElementById('speechTranscript').value = '';
  document.getElementById('evalCard').style.display = 'none';
}

// 7-Criteria Evaluation Execution
async function performEvaluation() {
  const text = document.getElementById('speechTranscript').value.trim();
  if (!text || text.split(/\s+/).length < 4) {
    alert('Please record or type at least 4-5 words before running the Band 8+ evaluation.');
    return;
  }

  const questionTitle = document.getElementById('promptTitle').innerText;
  const apiKey = document.getElementById('geminiKeyInput').value.trim();

  let evalResult;
  if (apiKey) {
    evalResult = await evaluateWithGeminiAI(text, questionTitle, apiKey);
  } else {
    evalResult = IELTS_EVALUATOR.evaluate(text, secondsSpoken || 30, questionTitle);
  }

  if (evalResult.error) {
    alert(evalResult.error);
    return;
  }

  displayEvaluationReport(evalResult);

  // Save session locally to localStorage and backend
  saveSession({
    phase: activePhase,
    question: questionTitle,
    transcript: text,
    overallBand: evalResult.overallBand,
    wpm: evalResult.wpm,
    criteria: evalResult.criteria,
    modelRephrase: evalResult.modelRephrase
  });
}

// Display Report in UI
function displayEvaluationReport(res) {
  document.getElementById('overallBandNumber').innerText = res.overallBand;
  document.getElementById('wpmStat').innerText = `${res.wpm || '--'} WPM`;
  document.getElementById('wordCountStat').innerText = `${res.wordCount || '--'} Words`;

  // Render 7 Criteria
  const grid = document.getElementById('criteriaGrid');
  grid.innerHTML = '';
  Object.keys(res.criteria).forEach(k => {
    const c = res.criteria[k];
    const card = document.createElement('div');
    card.className = 'criterion-box';
    card.innerHTML = `
      <div class="criterion-header">
        <span class="criterion-name">${c.name}</span>
        <span class="criterion-grade">Band ${c.score}</span>
      </div>
      <p class="criterion-desc">${c.feedback}</p>
    `;
    grid.appendChild(card);
  });

  // Render Band 8.5 Model Rephrase
  document.getElementById('modelRephraseContent').innerText = res.modelRephrase;

  // Render Vocabulary Upgrades Table
  const tbody = document.getElementById('upgradeTableBody');
  tbody.innerHTML = '';
  (res.upgrades || []).forEach(u => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="pill-original">${u.original}</span></td>
      <td><span class="pill-upgraded">${u.upgrade}</span></td>
      <td style="color: var(--text-secondary);">${u.note}</td>
    `;
    tbody.appendChild(tr);
  });

  // Render Actionable Tips
  const tipsList = document.getElementById('tipsList');
  tipsList.innerHTML = '';
  (res.actionableTips || []).forEach(tip => {
    const li = document.createElement('li');
    li.innerText = tip;
    tipsList.appendChild(li);
  });

  const card = document.getElementById('evalCard');
  card.style.display = 'flex';
  card.scrollIntoView({ behavior: 'smooth' });
}

// Optional Gemini LLM Evaluation
async function evaluateWithGeminiAI(text, question, apiKey) {
  const prompt = `You are a Senior Cambridge IELTS Speaking Examiner assessing for Band 8.5+.
Evaluate this candidate's response.
Question: "${question}"
Candidate Transcript: "${text}"

Assess all 7 operational criteria (Band 0-9):
1. Fluency & Speech Continuity
2. Coherence & Discourse Structure
3. Lexical Breadth & Precision
4. Idiomatic Collocations
5. Grammatical Complexity & Range
6. Grammatical Accuracy & Error Ratio
7. Delivery Cadence & Rhythm

Return pure JSON only:
{
  "overallBand": "8.5",
  "wpm": 135,
  "criteria": {
    "fluency": { "name": "1. Fluency & Speech Continuity", "score": "8.5", "feedback": "..." },
    "coherence": { "name": "2. Coherence & Discourse Structure", "score": "8.5", "feedback": "..." },
    "lexical": { "name": "3. Lexical Breadth & Precision", "score": "8.0", "feedback": "..." },
    "idiomatic": { "name": "4. Idiomatic Collocations", "score": "8.5", "feedback": "..." },
    "grammarRange": { "name": "5. Grammatical Complexity", "score": "8.5", "feedback": "..." },
    "grammarAcc": { "name": "6. Grammatical Accuracy", "score": "8.5", "feedback": "..." },
    "pronunciation": { "name": "7. Delivery Cadence & Rhythm", "score": "8.5", "feedback": "..." }
  },
  "modelRephrase": "Native C2 rephrase of the candidate's exact answer...",
  "upgrades": [
    { "original": "candidate word", "upgrade": "band 8.5 replacement", "note": "explanation" }
  ],
  "actionableTips": ["Tip 1...", "Tip 2..."]
}`;

  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });
    const data = await resp.json();
    return JSON.parse(data.candidates[0].content.parts[0].text);
  } catch (e) {
    console.warn('Gemini call failed, falling back to local evaluator', e);
    return IELTS_EVALUATOR.evaluate(text, secondsSpoken || 30, question);
  }
}

// AI Question Generator Trigger
async function triggerAIGenerator() {
  const customTopic = prompt("Enter a specific topic for the AI exam (or leave blank for a random Cambridge theme):", "");
  const apiKey = document.getElementById('geminiKeyInput').value.trim();

  const btn = document.getElementById('aiGenerateBtn');
  const originalText = btn.innerText;
  btn.innerText = '✨ Synthesizing Exam...';
  btn.disabled = true;

  try {
    const generated = await IELTS_AI_GENERATOR.generate(customTopic, apiKey);

    // Insert into question bank
    const p1Item = {
      id: 'ai_p1_' + Date.now(),
      category: generated.category,
      isAIGenerated: true,
      question: generated.part1Question
    };
    const p2Item = {
      id: 'ai_p2_' + Date.now(),
      category: generated.category,
      isAIGenerated: true,
      title: generated.part2CueCard.title,
      prompts: generated.part2CueCard.prompts
    };
    const p3Item = {
      id: 'ai_p3_' + Date.now(),
      category: generated.category,
      isAIGenerated: true,
      questions: generated.part3Questions
    };

    questionsData.part1.unshift(p1Item);
    questionsData.part2.unshift(p2Item);
    questionsData.part3.unshift(p3Item);

    // Set filter to AI generated or all, and switch view to the generated item
    currentFilter = 'all';
    currentQuestionIndex = 0;
    renderTopicList();
    displayActiveQuestion();

    alert(`✨ New AI IELTS Exam generated: "${generated.category}"!\nAdded to Part 1, Part 2, and Part 3.`);
  } catch (err) {
    alert("Failed to generate AI question. Please try again.");
    console.error(err);
  } finally {
    btn.innerText = originalText;
    btn.disabled = false;
  }
}

// Robust Persistence: LocalStorage (Primary for Vercel) + API (Sync)
function saveSession(sessionData) {
  const session = {
    id: 'session_' + Date.now(),
    timestamp: new Date().toISOString(),
    ...sessionData
  };

  // 1. Save to LocalStorage
  let localHistory = [];
  try {
    localHistory = JSON.parse(localStorage.getItem('ielts_practice_history') || '[]');
  } catch (e) {}
  localHistory.unshift(session);
  localStorage.setItem('ielts_practice_history', JSON.stringify(localHistory.slice(0, 100)));

  // 2. Background sync to server API
  fetch('/api/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sessionData)
  }).catch(() => {});
}

function loadHistorySessions() {
  const container = document.getElementById('historyItemsList');
  let history = [];

  try {
    history = JSON.parse(localStorage.getItem('ielts_practice_history') || '[]');
  } catch (e) {}

  if (!history.length) {
    container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 2rem;">No practice sessions recorded yet. Practice speaking to track your Band progression!</p>';
    return;
  }

  container.innerHTML = '';
  history.forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
      <div>
        <div style="font-weight: 700; color: #fff; margin-bottom: 0.25rem;">${item.question}</div>
        <div style="font-size: 0.8rem; color: var(--text-muted);">${new Date(item.timestamp).toLocaleString()} &bull; ${item.phase.toUpperCase()}</div>
        <p style="font-size: 0.85rem; color: #94a3b8; margin-top: 0.4rem; max-width: 650px;">“${item.transcript}”</p>
      </div>
      <div style="text-align: right;">
        <div style="font-family: 'JetBrains Mono'; font-size: 1.5rem; font-weight: 800; color: #10b981;">Band ${item.overallBand}</div>
      </div>
    `;
    container.appendChild(div);
  });
}

function clearAllHistory() {
  if (confirm('Are you sure you want to clear your practice history?')) {
    localStorage.removeItem('ielts_practice_history');
    fetch('/api/history', { method: 'DELETE' }).catch(() => {});
    loadHistorySessions();
  }
}

// Initial Boot
window.addEventListener('DOMContentLoaded', () => {
  initSpeechEngine();
  fetchQuestions();
});
