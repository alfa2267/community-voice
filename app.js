'use strict';

// Helpers
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
function debounce(fn, wait = 100) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

const storage = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
};

// Shared storage keys
const VOTES_KEY = 'votenoir:votes';

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

// Parallax blobs
function setupParallax() {
  const blobs = $$('.blob');
  if (!blobs.length) return;
  const onScroll = () => {
    const y = window.scrollY;
    blobs.forEach(b => {
      const f = parseFloat(b.getAttribute('data-parallax-factor') || '1');
      b.style.transform = `translate3d(${(y * 0.022 * f).toFixed(2)}px, ${(y * 0.18 * f).toFixed(2)}px, 0)`;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// Counters
function setupCounters() {
  const counters = $$('.stat-number');
  if (!counters.length) return;

  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      io.unobserve(el);
      const rawTarget = el.getAttribute('data-count-to') || '0';
      const hasSuffix = /[%K]$/.test(el.textContent.trim());
      const suffix = el.textContent.trim().match(/[%K]+$/)?.[0] ?? '';
      const target = parseInt(rawTarget, 10) || 0;
      const start = performance.now();
      const duration = clamp(600 + target * 0.2, 700, 1600);

      function tick(t) {
        const k = clamp((t - start) / duration, 0, 1);
        const val = Math.floor(target * (1 - Math.pow(1 - k, 3)));
        el.textContent = `${val}${hasSuffix ? suffix : ''}`;
        if (k < 1) requestAnimationFrame(tick); else el.textContent = `${target}${hasSuffix ? suffix : ''}`;
      }
      requestAnimationFrame(tick);
    });
  }, { threshold: 0.2 });

  counters.forEach(c => io.observe(c));
}

// Voting
function setupVoting() {
  const cards = $$('.card');
  const votes = storage.get(VOTES_KEY, {});

  function getPollCounts(pollId) {
    const poll = votes[pollId] || { total: 0, options: {} };
    return poll;
  }

  function savePollCounts(pollId, poll) {
    votes[pollId] = poll;
    storage.set(VOTES_KEY, votes);
  }

  function getUserVote(pollId) {
    return storage.get(`votenoir:poll:${pollId}`, null);
  }

  function setUserVote(pollId, option) {
    storage.set(`votenoir:poll:${pollId}`, option);
  }

  function renderResults(card) {
    const pollId = card.getAttribute('data-poll-id');
    const poll = getPollCounts(pollId);
    const results = $$('.bar', card);
    const total = Math.max(1, poll.total); // avoid div-by-zero

    results.forEach(row => {
      const option = row.getAttribute('data-option');
      const count = poll.options[option] || 0;
      const pct = Math.round((count / total) * 100);
      $('.fill', row).style.width = pct + '%';
      $('.value', row).textContent = pct + '%';
    });
  }

  function lockOptions(card) {
    $$('.option', card).forEach(btn => btn.setAttribute('disabled', 'true'));
  }

  function unlockOptions(card) {
    $$('.option', card).forEach(btn => btn.removeAttribute('disabled'));
  }

  function showResults(card) {
    $('.results', card).classList.remove('hidden');
    renderResults(card);
  }

  function hideResults(card) {
    $('.results', card).classList.add('hidden');
  }

  cards.forEach(card => {
    const pollId = card.getAttribute('data-poll-id');
    const note = $('.note', card);
    const showBtn = $('.show-results', card);

    // init state
    const userVote = getUserVote(pollId);
    if (userVote) {
      lockOptions(card);
      const chosenBtn = $(`.option[data-option="${CSS.escape(userVote)}"]`, card);
      if (chosenBtn) chosenBtn.classList.add('selected');
      if (note) note.textContent = `You voted: ${userVote}`;
      showResults(card);
    } else {
      hideResults(card);
      if (note) note.textContent = '';
    }

    // option clicks
    $$('.option', card).forEach(btn => {
      btn.addEventListener('click', () => {
        const chosen = btn.getAttribute('data-option');
        if (getUserVote(pollId)) return; // already voted

        const poll = getPollCounts(pollId);
        poll.total += 1;
        poll.options[chosen] = (poll.options[chosen] || 0) + 1;
        savePollCounts(pollId, poll);
        setUserVote(pollId, chosen);

        // Save to JSON format
        const pollTitle = $('.card-title', card)?.textContent || pollId;
        addPollVote(pollId, pollTitle, chosen);

        lockOptions(card);
        btn.classList.add('selected');
        // Play ballot animation on the clicked option
        playBallotAnim(btn, 'yes');
        if (note) note.textContent = `You voted: ${chosen}`;

        showResults(card);
        updateVoteCount();
      });
    });

    // show results toggle
    if (showBtn) {
      showBtn.addEventListener('click', () => {
        const isHidden = $('.results', card).classList.contains('hidden');
        if (isHidden) showResults(card); else hideResults(card);
      });
    }
  });
}

function setCurrentYear() {
  const y = new Date().getFullYear();
  const target = document.getElementById('year');
  if (target) target.textContent = y;
}

// Pick Grid
function initPickGrid() {
  const grid = document.querySelector('.filter-grid');
  if (!grid) return;

  const summaryEl = document.getElementById('pick-summary');
  const storageKey = 'pickSelections';

  const saved = safeParse(localStorage.getItem(storageKey)) || {};

  // Apply saved state
  grid.querySelectorAll('.tile').forEach(tile => {
    const id = tile.getAttribute('data-item-id');
    const val = saved[id];
    applyTileState(tile, val);
  });
  updatePickSummary(summaryEl, saved);

  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.tile-action');
    if (!btn) return;
    const tile = e.target.closest('.tile');
    if (!tile) return;

    const id = tile.getAttribute('data-item-id');
    const pick = btn.dataset.pick; // 'yes' | 'no'

    saved[id] = pick;
    localStorage.setItem(storageKey, JSON.stringify(saved));
    
    // Save to JSON format
    const programTitle = tile.querySelector('.tile-title')?.textContent || id;
    addProgramVote(id, programTitle, pick);
    
    applyTileState(tile, pick);
    playBallotAnim(tile, pick);
    updatePickSummary(summaryEl, saved);
    updateVoteCount();
  });

  // Tools: Copy SVG / Download
  grid.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('.copy-svg');
    const dlBtn = e.target.closest('.download-svg');
    if (!copyBtn && !dlBtn) return;
    const tile = e.target.closest('.tile');
    if (!tile) return;
    e.stopPropagation();

    const svgEl = tile.querySelector('.tile-canvas svg');
    if (!svgEl) return;
    const svgString = serializeSVG(svgEl);
    const name = (tile.getAttribute('data-item-id') || tile.querySelector('.tile-title')?.textContent || 'icon').trim();

    if (copyBtn) {
      try {
        await navigator.clipboard.writeText(svgString);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => (copyBtn.textContent = 'Copy SVG'), 1000);
      } catch (err) {
        console.warn('Clipboard API failed, offering download instead', err);
        triggerDownload(name + '.svg', svgString);
      }
    }
    if (dlBtn) {
      triggerDownload(name + '.svg', svgString);
    }
  });
}

function applyTileState(tile, pick) {
  tile.classList.remove('selected-yes', 'selected-no');
  if (pick === 'yes') tile.classList.add('selected-yes');
  if (pick === 'no') tile.classList.add('selected-no');
}

function updatePickSummary(el, map) {
  if (!el) return;
  const vals = Object.values(map || {});
  const yes = vals.filter(v => v === 'yes').length;
  const no = vals.filter(v => v === 'no').length;
  const total = vals.length;
  el.textContent = total
    ? `Picked: ${yes} Support (+), ${no} Oppose (-) · Total ${total}`
    : 'No selections yet. Hover any item and choose + or -.';
  
  // Enable/disable submit button based on selections
  const submitBtn = document.getElementById('submitPicks');
  if (submitBtn) {
    submitBtn.disabled = total === 0;
  }
}

function safeParse(v) { try { return JSON.parse(v); } catch { return null; } }

// Ballot animation inside a tile
function ensureBallotOverlay(root) {
  const host = root.querySelector?.('.tile-visual') || root;
  let overlay = host.querySelector('.ballot-anim');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'ballot-anim';
    try { overlay.style.color = getComputedStyle(host).color; } catch {}
    overlay.innerHTML = `
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <g class="box" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <rect x="18" y="32" width="44" height="30" rx="4"/>
          <path class="acc" d="M28 28h24"/>
        </g>
        <rect class="paper" x="33" y="8" width="14" height="18" rx="1.5" fill="currentColor" stroke="none"/>
      </svg>`;
    host.appendChild(overlay);
  }
  return overlay;
}

function playBallotAnim(el, type /* 'yes' | 'no' */) {
  const overlay = ensureBallotOverlay(el);
  overlay.classList.remove('yes', 'no', 'play');
  if (type === 'yes') overlay.classList.add('yes'); else if (type === 'no') overlay.classList.add('no');
  // Retrigger animation
  // Force reflow
  void overlay.offsetWidth;
  overlay.classList.add('play');
  // Remove play after finished so it can replay
  setTimeout(() => overlay.classList.remove('play'), 1200);
}

// Filters for pick grid
function initPickFilters() {
  const wrapper = document.querySelector('.filters');
  const grid = document.querySelector('.filter-grid');
  if (!wrapper || !grid) return;

  const buttons = Array.from(wrapper.querySelectorAll('.filter-btn'));
  const tiles = Array.from(grid.querySelectorAll('.tile'));
  const searchInput = document.getElementById('pick-search');

  let activeKey = 'all';
  let query = '';

  function applyFilters() {
    const q = query.trim();
    tiles.forEach(tile => {
      const tags = (tile.getAttribute('data-tags') || '').toLowerCase();
      const id = (tile.getAttribute('data-item-id') || '').toLowerCase();
      const title = (tile.querySelector('.tile-title')?.textContent || '').toLowerCase();
      const keyMatch = activeKey === 'all' || tags.split(/\s*,\s*/).includes(activeKey);
      const textMatch = !q || tags.includes(q) || id.includes(q) || title.includes(q);
      tile.style.display = keyMatch && textMatch ? '' : 'none';
    });
  }

  wrapper.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    buttons.forEach(b => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
    });
    activeKey = (btn.getAttribute('data-filter') || 'all').toLowerCase();
    applyFilters();
  });

  // Initial
  const active = buttons.find(b => b.classList.contains('active'));
  activeKey = (active?.getAttribute('data-filter') || 'all').toLowerCase();
  applyFilters();

  // Search input
  if (searchInput) {
    const debounced = debounce((v) => {
      query = (v || '').toLowerCase();
      applyFilters();
    }, 80);
    searchInput.addEventListener('input', (e) => debounced(e.target.value));
  }
}

// Serialize an inline SVG element to string with xmlns
function serializeSVG(svgEl) {
  const clone = svgEl.cloneNode(true);
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // Ensure stroke-width has decimals preserved; outerHTML is sufficient here
  return clone.outerHTML;
}

function triggerDownload(filename, text) {
  const blob = new Blob([text], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Mobile menu (non-functional placeholder for now)
function setupMenuToggle() {
  const btn = $('#menuToggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    // Could open a drawer; for now, just a subtle click effect.
    btn.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.96)' }, { transform: 'scale(1)' }], { duration: 160, easing: 'ease-out' });
  });
}

window.addEventListener('DOMContentLoaded', () => {
  setupParallax();
  setupCounters();
  setupVoting();
  setCurrentYear();
  normalizeTileOverlays();
  initPickGrid();
  initPickFilters();
  setupMenuToggle();
  setupResetVotesButton();
  setupSubmitPicksButton();
  setupAboutYouForm();
  setupExportButton();
  setupCalendarButtons();
});

// Ensure overlays can cover full tile even if authored inside .tile-visual
function normalizeTileOverlays() {
  document.querySelectorAll('.tile').forEach(tile => {
    const visual = tile.querySelector('.tile-visual');
    if (!visual) return;
    // If overlay exists at tile root, move it into visual
    let overlay = tile.querySelector(':scope > .tile-overlay');
    if (!overlay) overlay = visual.querySelector(':scope > .tile-overlay');
    if (overlay && overlay.parentElement !== visual) visual.appendChild(overlay);
  });
}

// Reset all votes for all polls and update UI
function resetAllVotes() {
  // Clear aggregate votes map
  storage.set(VOTES_KEY, {});

  // Clear per-poll user choice and reset each card
  const cards = $$('.card');
  cards.forEach(card => {
    const pollId = card.getAttribute('data-poll-id');
    try { localStorage.removeItem(`votenoir:poll:${pollId}`); } catch {}

    // Unlock options and remove selection highlight
    $$('.option', card).forEach(btn => {
      btn.removeAttribute('disabled');
      btn.classList.remove('selected');
    });

    // Reset results visuals and hide
    const results = $$('.bar', card);
    results.forEach(row => {
      const fill = $('.fill', row);
      const val = $('.value', row);
      if (fill) fill.style.width = '0%';
      if (val) val.textContent = '0%';
    });
    const resWrap = $('.results', card);
    if (resWrap) resWrap.classList.add('hidden');

    const note = $('.note', card);
    if (note) note.textContent = '';
  });
  
  // Clear picks and update UI
  localStorage.removeItem('pickSelections');
  const tiles = document.querySelectorAll('.tile');
  tiles.forEach(tile => applyTileState(tile, null));
  const summaryEl = document.getElementById('pick-summary');
  updatePickSummary(summaryEl, {});
  
  // Clear centralized JSON data
  localStorage.removeItem('communityVotingData');
  
  // Update vote count
  updateVoteCount();
}

function setupResetVotesButton() {
  const btn = document.getElementById('resetVotes');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const ok = confirm('Reset all votes? This only clears local demo data on this device.');
    if (!ok) return;
    resetAllVotes();
  });
}

function setupSubmitPicksButton() {
  const btn = document.getElementById('submitPicks');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const storageKey = 'pickSelections';
    const saved = safeParse(localStorage.getItem(storageKey)) || {};
    const selections = Object.entries(saved);
    
    if (selections.length === 0) {
      alert('No picks selected yet. Please select some items first.');
      return;
    }
    
    const yesCount = selections.filter(([_, vote]) => vote === 'yes').length;
    const noCount = selections.filter(([_, vote]) => vote === 'no').length;
    
    const message = `Submitting ${selections.length} picks:\n${yesCount} Support (+) votes\n${noCount} Oppose (-) votes\n\nThis is a demo - in a real app, this would send to a server.`;
    
    if (confirm(message)) {
      // In a real app, you would send this data to a server
      console.log('Picks submitted:', saved);
      alert('Picks submitted successfully! (Demo mode - check console for data)');
      
      // Optionally clear selections after submit
      // localStorage.removeItem(storageKey);
      // location.reload(); // or refresh the grid
    }
  });
}

function setupAboutYouForm() {
  const neighborhood = document.getElementById('neighborhood');
  const residency = document.getElementById('residency');
  const interest = document.getElementById('interest');
  const storageKey = 'aboutYouData';
  
  if (!neighborhood || !residency || !interest) return;
  
  // Load saved data
  const saved = safeParse(localStorage.getItem(storageKey)) || {};
  if (saved.neighborhood) neighborhood.value = saved.neighborhood;
  if (saved.residency) residency.value = saved.residency;
  if (saved.interest) interest.value = saved.interest;
  
  // Save data on change
  const saveData = () => {
    const data = {
      neighborhood: neighborhood.value,
      residency: residency.value,
      interest: interest.value
    };
    localStorage.setItem(storageKey, JSON.stringify(data));
    
    // Also save to centralized JSON
    updateVoterProfile(data);
  };
  
  neighborhood.addEventListener('change', saveData);
  residency.addEventListener('change', saveData);
  interest.addEventListener('change', saveData);
  
  // Update vote count display
  updateVoteCount();
}

function updateVoteCount() {
  const votesCountEl = document.getElementById('votesCount');
  if (!votesCountEl) return;
  
  // Get centralized voting data
  const votingData = getVotingData();
  const totalVotes = Object.keys(votingData.programVotes).length + Object.keys(votingData.pollVotes).length;
  
  votesCountEl.textContent = totalVotes;
}

// Centralized JSON voting data management
function getVotingData() {
  const defaultData = {
    timestamp: new Date().toISOString(),
    voterProfile: {},
    programVotes: {},
    pollVotes: {},
    summary: {
      totalVotes: 0,
      programsSupported: 0,
      programsOpposed: 0,
      pollsCompleted: 0
    }
  };
  
  const stored = safeParse(localStorage.getItem('communityVotingData')) || defaultData;
  return stored;
}

function saveVotingData(data) {
  // Update timestamp and summary
  data.timestamp = new Date().toISOString();
  data.summary = {
    totalVotes: Object.keys(data.programVotes).length + Object.keys(data.pollVotes).length,
    programsSupported: Object.values(data.programVotes).filter(v => v.vote === 'yes').length,
    programsOpposed: Object.values(data.programVotes).filter(v => v.vote === 'no').length,
    pollsCompleted: Object.keys(data.pollVotes).length
  };
  
  localStorage.setItem('communityVotingData', JSON.stringify(data, null, 2));
}

function addProgramVote(programId, programTitle, vote) {
  const data = getVotingData();
  data.programVotes[programId] = {
    title: programTitle,
    vote: vote, // 'yes' or 'no'
    timestamp: new Date().toISOString()
  };
  saveVotingData(data);
}

function addPollVote(pollId, pollTitle, selectedOption) {
  const data = getVotingData();
  data.pollVotes[pollId] = {
    title: pollTitle,
    selectedOption: selectedOption,
    timestamp: new Date().toISOString()
  };
  saveVotingData(data);
}

function updateVoterProfile(profile) {
  const data = getVotingData();
  data.voterProfile = {
    ...data.voterProfile,
    ...profile,
    lastUpdated: new Date().toISOString()
  };
  saveVotingData(data);
}

function exportVotingData() {
  const data = getVotingData();
  const jsonString = JSON.stringify(data, null, 2);
  
  // Create download
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `community-voting-data-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  
  return jsonString;
}

function setupExportButton() {
  const exportBtn = document.getElementById('exportData');
  if (!exportBtn) return;
  
  exportBtn.addEventListener('click', () => {
    const data = getVotingData();
    if (data.summary.totalVotes === 0) {
      alert('No voting data to export yet. Cast some votes first!');
      return;
    }
    
    try {
      exportVotingData();
      alert(`Successfully exported ${data.summary.totalVotes} votes to JSON file!`);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed. Please try again.');
    }
  });
}

function setupCalendarButtons() {
  const subscribeBtn = document.getElementById('subscribeCalendar');
  const rsvpBtn = document.getElementById('rsvpMeeting');
  
  if (subscribeBtn) {
    subscribeBtn.addEventListener('click', () => {
      // Generate calendar subscription file (.ics)
      const calendarData = generateCalendarData();
      downloadCalendarFile(calendarData);
      alert('Calendar file downloaded! Import it into your calendar app to get automatic reminders for all town hall meetings.');
    });
  }
  
  if (rsvpBtn) {
    rsvpBtn.addEventListener('click', () => {
      // Show RSVP form
      showRSVPForm();
    });
  }
  
  // Modal event listeners
  const modal = document.getElementById('rsvpModal');
  const modalClose = document.querySelector('.modal-close');
  const modalBackdrop = document.querySelector('.modal-backdrop');
  const cancelBtn = document.getElementById('cancelRSVP');
  const rsvpForm = document.getElementById('rsvpForm');
  
  if (modalClose) {
    modalClose.addEventListener('click', hideRSVPForm);
  }
  
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', hideRSVPForm);
  }
  
  if (cancelBtn) {
    cancelBtn.addEventListener('click', hideRSVPForm);
  }
  
  if (rsvpForm) {
    rsvpForm.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const formData = new FormData(rsvpForm);
      const data = {
        name: formData.get('name').trim(),
        email: formData.get('email').trim(),
        phone: formData.get('phone').trim(),
        childcare: formData.has('childcare'),
        comments: formData.get('comments').trim()
      };
      
      // Validate required fields
      if (!data.name) {
        alert('Please enter your name.');
        document.getElementById('rsvpName').focus();
        return;
      }
      
      handleRSVPSubmit(data);
    });
  }
  
  // Escape key to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
      hideRSVPForm();
    }
  });
}

function generateCalendarData() {
  const events = [
    {
      title: 'Community Budget Planning',
      date: '2025-02-13T19:00:00',
      endDate: '2025-02-13T21:00:00',
      location: 'Community Center, Main Hall',
      description: 'Discuss and vote on next year\'s community budget priorities. Your input shapes local spending decisions.'
    },
    {
      title: 'Parks & Recreation Updates',
      date: '2025-03-13T19:00:00',
      endDate: '2025-03-13T21:00:00',
      location: 'Community Center, Main Hall',
      description: 'Review progress on community garden, playground upgrades, and discuss new recreational programs for all ages.'
    },
    {
      title: 'Transportation & Safety Forum',
      date: '2025-04-10T19:00:00',
      endDate: '2025-04-10T21:00:00',
      location: 'Community Center, Main Hall',
      description: 'Discuss bike lane proposals, street lighting improvements, and traffic safety measures for our neighborhood.'
    },
    {
      title: 'Community Events Planning',
      date: '2025-05-08T19:00:00',
      endDate: '2025-05-08T21:00:00',
      location: 'Community Center, Main Hall',
      description: 'Plan summer festivals, farmers market schedule, and volunteer coordination for upcoming community events.'
    }
  ];

  let icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Community Voice//Town Halls//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];

  events.forEach((event, index) => {
    // Convert date to proper ICS format: YYYYMMDDTHHMMSS
    const startDate = event.date.replace(/[-:]/g, '').replace('T', 'T');
    const endDate = event.endDate.replace(/[-:]/g, '').replace('T', 'T');
    const uid = `townhall-${index}-${Date.now()}@communityvoice.local`;
    
    icsContent.push(
      'BEGIN:VEVENT',
      `DTSTART:${startDate}`,
      `DTEND:${endDate}`,
      `SUMMARY:${event.title}`,
      `DESCRIPTION:${event.description.replace(/[^\w\s]/g, '')}`,
      `LOCATION:${event.location}`,
      `UID:${uid}`,
      'STATUS:CONFIRMED',
      'END:VEVENT'
    );
  });

  icsContent.push('END:VCALENDAR');
  return icsContent.join('\r\n');
}

function downloadCalendarFile(icsContent) {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'community-town-halls.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function showRSVPForm() {
  const modal = document.getElementById('rsvpModal');
  if (!modal) return;
  
  // Load existing RSVP data if any
  const rsvpData = safeParse(localStorage.getItem('townHallRSVP')) || {};
  if (rsvpData.nextMeeting) {
    document.getElementById('rsvpName').value = rsvpData.nextMeeting.name || '';
    document.getElementById('rsvpEmail').value = rsvpData.nextMeeting.email || '';
    document.getElementById('rsvpPhone').value = rsvpData.nextMeeting.phone || '';
    document.getElementById('rsvpChildcare').checked = rsvpData.nextMeeting.childcare || false;
    document.getElementById('rsvpComments').value = rsvpData.nextMeeting.comments || '';
  }
  
  // Show modal
  modal.classList.remove('hidden');
  
  // Focus first input
  setTimeout(() => {
    document.getElementById('rsvpName').focus();
  }, 100);
}

function hideRSVPForm() {
  const modal = document.getElementById('rsvpModal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

function handleRSVPSubmit(formData) {
  // Save RSVP data
  const rsvpData = safeParse(localStorage.getItem('townHallRSVP')) || {};
  rsvpData.nextMeeting = {
    name: formData.name,
    email: formData.email,
    phone: formData.phone,
    childcare: formData.childcare,
    comments: formData.comments,
    timestamp: new Date().toISOString(),
    meetingDate: '2025-02-13',
    meetingTitle: 'Community Budget Planning'
  };
  
  localStorage.setItem('townHallRSVP', JSON.stringify(rsvpData));
  
  // Hide modal
  hideRSVPForm();
  
  // Show success message
  let confirmMessage = `Thank you ${formData.name}! You're registered for:\n\n`;
  confirmMessage += `📅 Community Budget Planning\n`;
  confirmMessage += `📍 Feb 13, 2025 at 7:00 PM\n`;
  confirmMessage += `🏢 Community Center, Main Hall\n\n`;
  if (formData.childcare) {
    confirmMessage += `✅ Childcare reserved\n\n`;
  }
  if (formData.email) {
    confirmMessage += `📧 Reminders will be sent to ${formData.email}\n\n`;
  }
  confirmMessage += `We look forward to seeing you there!`;
  
  alert(confirmMessage);
}
