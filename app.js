'use strict';

// Helpers
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

const storage = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
};

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
  const VOTES_KEY = 'votenoir:votes';
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

        lockOptions(card);
        if (note) note.textContent = `You voted: ${chosen}`;

        showResults(card);
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
    applyTileState(tile, pick);
    updatePickSummary(summaryEl, saved);
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
    ? `Picked: ${yes} Yes, ${no} No · Total ${total}`
    : 'No selections yet. Hover any item and choose Yes or No.';
}

function safeParse(v) { try { return JSON.parse(v); } catch { return null; } }

// Filters for pick grid
function initPickFilters() {
  const wrapper = document.querySelector('.filters');
  const grid = document.querySelector('.filter-grid');
  if (!wrapper || !grid) return;

  const buttons = Array.from(wrapper.querySelectorAll('.filter-btn'));
  const tiles = Array.from(grid.querySelectorAll('.tile'));

  function applyFilter(key) {
    tiles.forEach(tile => {
      const tags = (tile.getAttribute('data-tags') || '').toLowerCase();
      const match = key === 'all' || tags.split(/\s*,\s*/).includes(key);
      tile.style.display = match ? '' : 'none';
    });
  }

  wrapper.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    buttons.forEach(b => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
    });
    const key = (btn.getAttribute('data-filter') || 'all').toLowerCase();
    applyFilter(key);
  });

  // Initial
  const active = buttons.find(b => b.classList.contains('active'));
  applyFilter((active?.getAttribute('data-filter') || 'all').toLowerCase());
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
  initPickGrid();
  initPickFilters();
  setupMenuToggle();
});
