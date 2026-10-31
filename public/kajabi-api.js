var CourseApi = (function () {
  var BASE_URL = 'https://web-production-b4f12.up.railway.app';
  var ADMIN_API_KEY = 'local-dev-admin-key';
  var STORAGE_KEY = 'courseSync.purchaser';
  var PROFILE_FLAG = 'courseSync.needProfile';
  var kajabiUserId = '';
  var accountUserId = '';
  var identityReady = false;
  var pendingCompletion = null;
  var statusPollTimer = null;
  var partnerWaitTimer = null;
  var partnerWaitState = null;
  var partnerWaitRequest = 0;
  var playlistChecks = {};
  var playlistCheckObserver = null;

  function request(path, options) {
    var settings = options || {};
    var headers = {};
    if (settings.body !== undefined) headers['Content-Type'] = 'application/json';
    if (settings.admin) headers['X-Api-Key'] = ADMIN_API_KEY;
    if (settings.token) headers.Authorization = 'Bearer ' + settings.token;

    return fetch(BASE_URL + path, {
      method: settings.method || 'GET',
      headers: headers,
      keepalive: Boolean(settings.keepalive),
      body: settings.body === undefined ? undefined : JSON.stringify(settings.body),
    }).then(function (response) {
      return response.text().then(function (text) {
        var data = text ? JSON.parse(text) : null;
        if (!response.ok) {
          var error = new Error((data && data.message) || ('Request failed (' + response.status + ')'));
          error.status = response.status;
          error.body = data;
          throw error;
        }
        return data;
      });
    });
  }

  function compact(body) {
    var payload = {};
    Object.keys(body).forEach(function (key) {
      if (body[key] !== undefined && body[key] !== null && body[key] !== '') payload[key] = body[key];
    });
    return payload;
  }

  function readCookie(name) {
    var pieces = document.cookie ? document.cookie.split(';') : [];
    for (var index = 0; index < pieces.length; index += 1) {
      var piece = pieces[index].trim();
      if (piece.indexOf(name + '=') === 0) return decodeURIComponent(piece.slice(name.length + 1));
    }
    return '';
  }

  function savedPurchaser() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (error) {
      return null;
    }
  }

  function savePurchaser(result) {
    var data = result.data || result;
    var user = data.user || {};
    var existing = savedPurchaser() || {};
    var record = {
      id: user.id || data.userId || existing.id,
      name: user.name || data.name || existing.name || '',
      email: user.email || data.email || existing.email || '',
      token: data.token || existing.token || '',
      role: user.role || data.role || existing.role || '',
      kajabiUserId: user.kajabiUserId || data.kajabiUserId || existing.kajabiUserId || readCookie('rl_user_id'),
      plan: existing.plan || knownPlan(user.offerReference) || knownPlan(data.offerReference) || '',
      offerId: existing.offerId || '',
      thankYou: existing.thankYou || '',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    return record;
  }

  function knownPlan(value) {
    return value === 'one_time' || value === 'eight_month' ? value : '';
  }

  function isMissingIdentity(error) {
    var code = error && error.body && error.body.errorCode;
    return Boolean(error && (error.status === 404 || code === 'IDENTITY_NOT_FOUND' || /user not found/i.test(error.message || '')));
  }

  function isLessonPage() {
    return /\/posts\/\d+/.test(window.location.pathname) || Boolean(document.querySelector('.mark-as-complete, .btn--completion'));
  }

  function siteMemberId() {
    var siteUser = window.Kajabi && window.Kajabi.currentSiteUser;
    if (!siteUser || siteUser.id == null || String(siteUser.id) === '-1') return '';
    return String(siteUser.id);
  }

  function identityCandidates() {
    var ids = [];
    function add(id) {
      if (id == null) return;
      var value = String(id).trim();
      if (!value || value === '-1' || ids.indexOf(value) !== -1) return;
      ids.push(value);
    }
    add(readCookie('rl_user_id'));
    try {
      add(localStorage.getItem('courseSync.linkedId'));
    } catch (error) {
      /* storage can be blocked */
    }
    var saved = savedPurchaser();
    if (saved) add(saved.kajabiUserId);
    add(siteMemberId());
    return ids;
  }

  function cleanText(node) {
    return node ? node.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function playlistRoot(node) {
    if (node && node.closest) {
      var found = node.closest('.playlist');
      if (found) return found;
    }
    var active = document.querySelector('.playlist .track--active');
    if (active && active.closest) return active.closest('.playlist');
    var playlists = document.querySelectorAll('.playlist');
    return playlists.length === 1 ? playlists[0] : null;
  }

  function playlistTitle(playlist) {
    if (!playlist) return '';
    return cleanText(playlist.querySelector('.playlist__title h2, .playlist__title'));
  }

  function weekNumberFromPlaylist(playlist) {
    var match = playlistTitle(playlist).match(/Week\s+(\d+)/i);
    if (match) return Number(match[1]);
    var playlists = document.querySelectorAll('.playlist');
    if (playlist && playlists.length > 1) {
      for (var index = 0; index < playlists.length; index += 1) {
        if (playlists[index] === playlist) return index + 1;
      }
    }
    if (!playlist || playlists.length <= 1) {
      var subtitle = document.querySelector('.panel__sub-title');
      var subtitleMatch = cleanText(subtitle).match(/Week\s+(\d+)/i);
      if (subtitleMatch) return Number(subtitleMatch[1]);
    }
    return 0;
  }

  function readLesson() {
    var heading = document.querySelector('h1.panel__title, h1');
    var postMatch = window.location.pathname.match(/posts\/(\d+)/);
    return {
      title: cleanText(heading),
      weekNumber: weekNumberFromPlaylist(playlistRoot()),
      chapterId: postMatch ? postMatch[1] : '',
    };
  }

  function moduleLessons(playlist) {
    var root = playlist || playlistRoot();
    var weekNumber = weekNumberFromPlaylist(root);
    if (!root) return [];
    var tracks = root.querySelectorAll('a.track');
    var lessons = [];
    for (var index = 0; index < tracks.length; index += 1) {
      var track = tracks[index];
      if (track.classList.contains('track--more') || track.querySelector('.track__more')) continue;
      var href = track.getAttribute('href') || '';
      var postMatch = href.match(/posts\/(\d+)/);
      lessons.push({
        title: cleanText(track.querySelector('.track__title')),
        weekNumber: weekNumber,
        chapterId: postMatch ? postMatch[1] : '',
        completed: track.getAttribute('data-course-sync-complete') === 'true' || Boolean(track.querySelector('.fa-check')),
      });
    }
    return lessons;
  }

  function paintLessonCheck(chapterId, completed) {
    var id = chapterId ? String(chapterId) : '';
    if (!id) {
      var active = document.querySelector('.playlist a.track.track--active');
      var activeHref = active ? (active.getAttribute('href') || '') : '';
      var activeMatch = activeHref.match(/posts\/(\d+)/);
      id = activeMatch ? activeMatch[1] : '';
    }
    if (!id) return;
    playlistChecks[id] = Boolean(completed);
    applyPlaylistChecks();
  }

  function applyPlaylistChecks() {
    var root = playlistRoot() || document.querySelector('.playlist');
    if (!root) return;
    var tracks = root.querySelectorAll('a.track');
    for (var index = 0; index < tracks.length; index += 1) {
      var track = tracks[index];
      if (track.classList.contains('track--more') || track.querySelector('.track__more')) continue;
      var href = track.getAttribute('href') || '';
      var postMatch = href.match(/posts\/(\d+)/);
      var id = postMatch ? postMatch[1] : '';
      if (!id || !Object.prototype.hasOwnProperty.call(playlistChecks, id)) continue;
      var completed = playlistChecks[id];
      var slot = track.querySelector('.media-right');
      if (!slot) {
        slot = document.createElement('div');
        slot.className = 'media-right media-middle';
        track.appendChild(slot);
      }
      var hasCheck = Boolean(slot.querySelector('.fa-check'));
      if (completed) {
        track.setAttribute('data-course-sync-complete', 'true');
        if (!hasCheck) {
          slot.innerHTML = '<div class="progress__icon"><i class="fa fa-check" aria-hidden="true"></i></div>';
        }
      } else if (hasCheck || track.getAttribute('data-course-sync-complete') === 'true') {
        track.removeAttribute('data-course-sync-complete');
        slot.innerHTML = '';
      }
    }
  }

  function watchPlaylistChecks() {
    if (playlistCheckObserver) playlistCheckObserver.disconnect();
    var root = document.querySelector('.player__playlist') || document.querySelector('.playlist');
    if (!root || typeof MutationObserver !== 'function') return;
    playlistCheckObserver = new MutationObserver(function () {
      applyPlaylistChecks();
      var current = document.querySelector('.player__playlist') || document.querySelector('.playlist');
      if (current && current !== root && !root.contains(current)) {
        root = current;
        playlistCheckObserver.disconnect();
        playlistCheckObserver.observe(root, { childList: true, subtree: true });
      }
    });
    playlistCheckObserver.observe(root, { childList: true, subtree: true });
    applyPlaylistChecks();
  }

  function findWeek(person, weekNumber) {
    var weeks = person && person.weeks ? person.weeks : [];
    for (var index = 0; index < weeks.length; index += 1) {
      if (Number(weeks[index].weekNumber) === Number(weekNumber)) return weeks[index];
    }
    return weeks[weekNumber - 1] || null;
  }

  function incompleteNames(week) {
    if (!week || !week.chapters) return [];
    return week.chapters.filter(function (chapter) {
      return !chapter.completed;
    }).map(function (chapter) {
      return chapter.chapterName;
    });
  }

  function chapterLines(week) {
    if (!week || !week.chapters) return [];
    return week.chapters.map(function (chapter) {
      return chapter.chapterName + (chapter.completed ? ' — done' : ' — not done');
    });
  }

  function otherRole(course) {
    if (course && course.synchronization && course.synchronization.otherRole) return course.synchronization.otherRole;
    if (course && course.otherRole) return course.otherRole;
    var saved = savedPurchaser();
    return saved && saved.role === 'PARTNER' ? 'purchaser' : 'partner';
  }

  function ensureModal() {
    var existing = document.getElementById('course-sync-modal');
    if (existing) return existing;
    var style = document.createElement('style');
    style.textContent = ''
      + '#course-sync-modal{position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;background:rgba(28,22,18,.55);padding:16px;overflow:hidden;}'
      + '#course-sync-modal.is-open{display:flex;}'
      + '#course-sync-modal .course-sync-card{width:min(520px,100%);max-height:calc(100vh - 32px);overflow:hidden;background:#fffaf6;color:#2b211c;border-radius:16px;padding:22px 24px;box-shadow:0 20px 50px rgba(0,0,0,.2);font-family:Georgia,serif;}'
      + '#course-sync-modal h2{margin:0 0 6px;font-size:24px;line-height:1.2;}'
      + '#course-sync-modal p{margin:0 0 10px;line-height:1.4;}'
      + '#course-sync-modal ul{margin:0 0 10px;padding-left:18px;}'
      + '#course-sync-modal li{margin:0 0 4px;line-height:1.35;}'
      + '#course-sync-modal label{display:block;margin:8px 0 4px;font-size:14px;font-weight:700;}'
      + '#course-sync-modal input{width:100%;box-sizing:border-box;border:1px solid #d9cfc6;border-radius:8px;padding:10px 12px;font-size:16px;}'
      + '#course-sync-modal input.course-sync-input-error{border-color:#d32f2f !important;box-shadow:0 0 0 1px #d32f2f;}'
      + '#course-sync-modal button{margin-top:12px;border:0;border-radius:999px;background:#7a3048;color:#fff;padding:10px 18px;font-size:16px;cursor:pointer;}'
      + '#course-sync-modal .course-sync-note{margin:0 0 8px;color:#d32f2f;font-weight:600;line-height:1.35;}'
      + '#course-sync-modal .course-sync-why{margin:0 0 6px;font-weight:700;}'
      + '#course-sync-modal .course-sync-footnote{margin:10px 0 0;font-size:13px;line-height:1.35;color:#5c514a;}'
      + '#course-sync-modal .course-sync-footnote strong{display:block;margin-top:8px;font-weight:600;}'
      + '#course-sync-modal.is-locked{cursor:default;}'
      + '#course-sync-modal .course-sync-card-partner{position:relative;width:min(920px,100%);max-height:calc(100vh - 32px);overflow:hidden;padding:0;background:#fff;color:#241c22;border-radius:22px;font-family:"Segoe UI",system-ui,sans-serif;box-shadow:0 24px 70px rgba(40,20,28,.22);}'
      + '#course-sync-modal .course-sync-x{position:absolute;top:12px;right:14px;z-index:2;margin:0;width:32px;height:32px;padding:0;border-radius:8px;background:transparent;color:#8d8380;font-size:22px;line-height:32px;}'
      + '#course-sync-modal .course-sync-split{display:grid;grid-template-columns:minmax(280px,42%) minmax(0,1fr);min-height:460px;}'
      + '#course-sync-modal .course-sync-hero{display:flex;flex-direction:column;padding:28px 28px 24px;background:#fffaf8;}'
      + '#course-sync-modal .course-sync-art{display:flex;justify-content:center;margin:8px 0 18px;}'
      + '#course-sync-modal .course-sync-picture{display:block !important;width:100%;flex:1 1 auto;min-height:320px;margin:0 0 18px;background-repeat:no-repeat !important;background-position:center center !important;background-size:contain !important;}'
      + '#course-sync-modal .course-sync-picture img{display:none !important;}'
      + '#course-sync-modal svg{position:static !important;display:block !important;width:18px !important;height:18px !important;min-width:18px !important;min-height:18px !important;max-width:18px !important;max-height:18px !important;overflow:visible !important;transform:none !important;inset:auto !important;flex:none !important;}'
      + '#course-sync-modal .course-sync-card-partner h2{margin:0 0 10px;font-size:32px;line-height:1.15;font-weight:750;letter-spacing:-.03em;color:#1d1a1c;}'
      + '#course-sync-modal .course-sync-card-partner .course-sync-lead{margin:0;color:#6f6562;font-size:15px;line-height:1.45;}'
      + '#course-sync-modal .course-sync-together{display:flex;gap:12px;align-items:flex-start;margin-top:auto;padding:14px 16px;border-radius:16px;background:#fdecef;}'
      + '#course-sync-modal .course-sync-together strong{display:block;margin-bottom:2px;color:#2a2326;font-size:14px;}'
      + '#course-sync-modal .course-sync-together span{color:#6f6562;font-size:13px;line-height:1.4;}'
      + '#course-sync-modal .course-sync-people{position:relative !important;width:34px;height:34px;min-width:34px;border-radius:10px;background:#f8d5df;color:#c45c78;display:grid;place-items:center;overflow:hidden;flex:none;}'
      + '#course-sync-modal .course-sync-panel{padding:54px 28px 20px 24px;display:flex;flex-direction:column;min-width:0;}'
      + '#course-sync-modal .course-sync-panel-head{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;margin:0 0 16px;padding:0 8px 0 0;}'
      + '#course-sync-modal .course-sync-panel h3{margin:0 0 4px;font-size:18px;line-height:1.25;color:#1d1a1c;}'
      + '#course-sync-modal .course-sync-panel-head p{margin:0;color:#6f6562;font-size:13px;line-height:1.4;}'
      + '#course-sync-modal .course-sync-ring{width:74px;height:74px;border-radius:50%;display:grid;place-items:center;flex:none;background:conic-gradient(#7a3048 calc(var(--p) * 1%), #f6e6ec 0);}'
      + '#course-sync-modal .course-sync-ring.is-complete{background:conic-gradient(#2f9d62 calc(var(--p) * 1%), #e7f6ee 0);}'
      + '#course-sync-modal .course-sync-ring span{width:60px;height:60px;border-radius:50%;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.05;}'
      + '#course-sync-modal .course-sync-ring b{font-size:14px;color:#2b2326;}'
      + '#course-sync-modal .course-sync-ring small{margin-top:2px;font-size:9px;font-weight:600;color:#8d8380;}'
      + '#course-sync-modal .course-sync-lessons{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;overflow:auto;}'
      + '#course-sync-modal .course-sync-lessons li{display:flex;align-items:center;gap:10px;margin:0;padding:8px 10px;border:1px solid #f0e7ea;border-radius:12px;background:#fff;}'
      + '#course-sync-modal .course-sync-lesson-icon{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;flex:none;}'
      + '#course-sync-modal .course-sync-lesson-name{flex:1;min-width:0;font-size:14px;font-weight:650;color:#2a2426;}'
      + '#course-sync-modal .course-sync-status{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:4px 8px;font-size:12px;font-weight:650;white-space:nowrap;}'
      + '#course-sync-modal .course-sync-status.is-open{background:#fde8ee;color:#d15b78;}'
      + '#course-sync-modal .course-sync-status.is-done{background:#e8f7ee;color:#1f8a4c;}'
      + '#course-sync-modal .course-sync-card-partner .course-sync-close{margin:18px 0 0 auto;display:block;min-width:108px;padding:10px 22px;background:#7a3048;}'
      + '#course-sync-modal .course-sync-card-wait .course-sync-lessons{max-height:min(240px,32vh);overflow:auto;}'
      + '#course-sync-modal .course-sync-card-wait .course-sync-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;align-items:center;margin-top:18px;}'
      + '#course-sync-modal .course-sync-card-wait .course-sync-actions button{margin:0;}'
      + '#course-sync-modal .course-sync-card-wait .course-sync-back{margin-right:auto;background:#fff;color:#7a3048;border:1px solid #e7c9d3;}'
      + '#course-sync-modal .course-sync-card-wait .course-sync-resync{background:#fff;color:#7a3048;border:1px solid #e7c9d3;}'
      + '#course-sync-modal .course-sync-card-wait .course-sync-close{margin:0;display:inline-block;}'
      + '#course-sync-modal .course-sync-sync-note{margin:10px 0 0;font-size:12px;line-height:1.4;color:#6f6562;text-align:right;}'
      + '#course-sync-modal .course-sync-sync-note.is-error{color:#d32f2f;font-weight:600;}'
      + '#course-sync-modal button:disabled{opacity:.65;cursor:wait;}'
      + '#course-sync-modal .course-sync-card-email .course-sync-hero{display:flex;flex-direction:column;}'
      + '#course-sync-modal .course-sync-card-email .course-sync-together{margin-top:auto;}'
      + '#course-sync-modal .course-sync-card-email .course-sync-panel{padding:28px 28px 22px 24px;overflow:auto;}'
      + '#course-sync-modal .course-sync-reasons{list-style:none;margin:16px 0 8px;padding:0;display:flex;flex-direction:column;gap:12px;}'
      + '#course-sync-modal .course-sync-reasons li{display:flex;gap:12px;align-items:flex-start;margin:0;padding:0;}'
      + '#course-sync-modal .course-sync-reason-icon{position:relative !important;width:34px;height:34px;min-width:34px;border-radius:10px;display:grid;place-items:center;overflow:hidden;flex:none;}'
      + '#course-sync-modal .course-sync-reasons strong{display:block;margin:0 0 2px;font-size:14px;color:#2a2326;}'
      + '#course-sync-modal .course-sync-reasons span{display:block;margin:0;color:#6f6562;font-size:13px;line-height:1.4;}'
      + '#course-sync-modal .course-sync-req{color:#d15b78;}'
      + '#course-sync-modal .course-sync-field{position:relative;}'
      + '#course-sync-modal .course-sync-field svg{position:absolute !important;left:12px !important;top:50% !important;width:16px !important;height:16px !important;min-width:16px !important;min-height:16px !important;max-width:16px !important;max-height:16px !important;transform:translateY(-50%) !important;color:#8d8380;pointer-events:none;}'
      + '#course-sync-modal .course-sync-field input{padding-left:40px;border:1px solid #e4d9d4;border-radius:10px;}'
      + '#course-sync-modal .course-sync-card-email .course-sync-continue{width:100%;margin-top:14px;border-radius:12px;padding:12px 18px;font-weight:650;}'
      + '#course-sync-modal .course-sync-warn{display:flex;gap:10px;align-items:flex-start;margin-top:14px;padding:12px 14px;border-radius:12px;background:#fdecef;color:#6f6562;font-size:13px;line-height:1.4;}'
      + '#course-sync-modal .course-sync-warn svg{flex:none;margin-top:1px;color:#d15b78;}'
      + '#course-sync-modal .course-sync-warn strong{display:block;margin:0 0 4px;color:#2a2326;font-weight:650;}'
      + '#course-sync-modal .course-sync-card-stuck{width:min(780px,100%);}'
      + '#course-sync-modal .course-sync-card-stuck .course-sync-split{min-height:0;align-items:stretch;}'
      + '#course-sync-modal .course-sync-card-stuck .course-sync-hero{justify-content:center;padding:16px 4px 16px 16px;}'
      + '#course-sync-modal .course-sync-card-stuck .course-sync-panel{padding:32px 32px 28px 16px;justify-content:center;}'
      + '#course-sync-modal .course-sync-card-stuck h2{font-size:28px;}'
      + '#course-sync-modal .course-sync-card-stuck .course-sync-lead{margin:0 0 16px;}'
      + '#course-sync-modal .course-sync-card-stuck .course-sync-warn{margin-top:0;}'
      + '#course-sync-modal .course-sync-card-stuck .course-sync-back{display:inline-block;margin-top:18px;background:#7a3048;color:#fff;}'
      + '#course-sync-modal .course-sync-card-stuck .course-sync-sync-note{text-align:left;}'
      + '#course-sync-modal .course-sync-card-invite{width:min(440px,100%);padding:18px 22px 20px;border-radius:28px;background:#fff;}'
      + '#course-sync-modal .course-sync-card-invite h2{font-size:28px;text-align:center;margin:8px 0 8px;}'
      + '#course-sync-modal .course-sync-card-invite .course-sync-lead{text-align:center;margin:0 0 16px;color:#6d6468;}'
      + '#course-sync-modal .course-sync-invite-art{display:flex;justify-content:center;margin:8px 0 4px;}'
      + '#course-sync-modal .course-sync-invite-art svg{width:240px !important;height:168px !important;min-width:240px !important;min-height:168px !important;max-width:240px !important;max-height:168px !important;}'
      + '#course-sync-modal .course-sync-invite-steps{margin:0;padding:16px 16px 6px;border-radius:18px;background:#fdecef;display:flex;flex-direction:column;gap:14px;}'
      + '#course-sync-modal .course-sync-invite-steps li{display:flex;gap:12px;align-items:flex-start;margin:0;}'
      + '#course-sync-modal .course-sync-invite-steps strong{display:block;margin:0 0 2px;color:#2a2326;font-size:15px;}'
      + '#course-sync-modal .course-sync-invite-steps span{display:block;color:#6f6562;font-size:13px;line-height:1.4;}'
      + '#course-sync-modal .course-sync-invite-icon{width:36px;height:36px;min-width:36px;border-radius:50%;background:#f8d5df;color:#c45c78;display:grid;place-items:center;flex:none;}'
      + '#course-sync-modal .course-sync-card-add h2,#course-sync-modal .course-sync-card-add .course-sync-lead{text-align:left;}'
      + '#course-sync-modal .course-sync-card-add h2{margin:4px 28px 8px 0;}'
      + '#course-sync-modal .course-sync-card-invite .course-sync-invite-resync,#course-sync-modal .course-sync-card-invite .course-sync-invite-go{width:100%;margin-top:16px;border-radius:12px;padding:13px 16px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px;}'
      + '#course-sync-modal .course-sync-card-invite .course-sync-sync-note{text-align:center;}'
      + '@media (max-width:760px){#course-sync-modal .course-sync-split{display:block;min-height:0;}#course-sync-modal .course-sync-card-partner{overflow:auto;}#course-sync-modal .course-sync-card-partner h2{font-size:26px;}#course-sync-modal .course-sync-card-invite h2{font-size:24px;}}';
    document.head.appendChild(style);
    var modal = document.createElement('div');
    modal.id = 'course-sync-modal';
    modal.innerHTML = '<div class="course-sync-card"><h2></h2><p></p><div class="course-sync-body"></div><button type="button">Close</button><p class="course-sync-footnote" hidden></p></div>';
    modal.setAttribute('data-turbo-permanent', '');
    document.body.appendChild(modal);
    modal.addEventListener('click', function (event) {
      if (modal.classList.contains('is-locked')) event.stopPropagation();
      var node = event.target;
      if (node && node.nodeType !== 1) node = node.parentElement;
      if (!node || !node.closest) return;
      var back = node.closest('.course-sync-back');
      if (back) {
        event.preventDefault();
        goToPreviousWeek(back);
        return;
      }
      var resync = node.closest('.course-sync-resync');
      if (resync) {
        event.preventDefault();
        refreshPartnerWait(true);
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && modal.classList.contains('is-locked')) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
    return modal;
  }

  function resetCard(modal) {
    var card = modal.querySelector('.course-sync-card');
    var markup = '<h2></h2><p></p><div class="course-sync-body"></div><button type="button">Close</button><p class="course-sync-footnote" hidden></p>';
    if (!card) {
      modal.innerHTML = '<div class="course-sync-card">' + markup + '</div>';
      return modal.querySelector('.course-sync-card');
    }
    if (card.classList.contains('course-sync-card-partner')) {
      card.className = 'course-sync-card';
      card.innerHTML = markup;
    }
    return card;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (char) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
    });
  }

  function lessonIcon(index) {
    var tones = ['#f3e8ff|#7c3aed', '#e7f0ff|#3b6fd8', '#fde8ee|#e25b7a', '#e7f8ef|#2f9d62', '#fff4e5|#e39a2e', '#efe7ff|#7c3aed'];
    var tone = tones[index % tones.length].split('|');
    var glyphs = [
      '<path d="M9 7.5v9l8-4.5z" fill="currentColor" stroke="none"/>',
      '<path d="M8 6.5h5.5L17 10v8H8z"/><path d="M13.5 6.5V10H17"/>',
      '<rect x="7.5" y="8" width="9" height="6" rx="1.2"/><path d="M10 16.5h4"/>',
      '<path d="M8 6.5h8v11H8z"/><path d="M10 10h4M10 13h3"/>',
      '<path d="M8 5.5h8v13H8z"/><path d="M10 9h4M10 12h4"/>',
      '<path d="M8 12.5l2.4 2.4 5.6-6"/>'
    ];
    return '<span class="course-sync-lesson-icon" style="background:' + tone[0] + ';color:' + tone[1] + '"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">' + glyphs[index % glyphs.length] + '</svg></span>';
  }

  function partnerArt() {
    return '<svg class="course-sync-art" width="230" height="112" viewBox="0 0 230 112" aria-hidden="true">'
      + '<ellipse cx="58" cy="96" rx="46" ry="10" fill="#f6e4ea"/>'
      + '<ellipse cx="172" cy="96" rx="46" ry="10" fill="#f6e4ea"/>'
      + '<path d="M86 58c8-16 28-16 36 0" fill="none" stroke="#f3c3d0" stroke-width="2" stroke-dasharray="3 4"/>'
      + '<circle cx="104" cy="42" r="16" fill="#fdecef"/>'
      + '<path d="M98 42h12M104 36v12" stroke="#e7a3b6" stroke-width="1.6" fill="none"/>'
      + '<circle cx="58" cy="34" r="16" fill="#f2c7b4"/>'
      + '<path d="M42 34c2-14 30-16 34-2" fill="#3d2b28"/>'
      + '<path d="M34 92c2-24 14-34 24-34s22 10 24 34" fill="#7a3048"/>'
      + '<rect x="40" y="70" width="36" height="22" rx="3" fill="#d9c8bc"/>'
      + '<circle cx="172" cy="34" r="16" fill="#f2c7b4"/>'
      + '<path d="M156 40c4-18 28-18 32-2 2 6-2 10-8 10h-18c-4 0-8-3-6-8z" fill="#2b211c"/>'
      + '<path d="M148 92c2-24 14-34 24-34s22 10 24 34" fill="#f2b8c4"/>'
      + '<rect x="154" y="70" width="36" height="22" rx="3" fill="#d9c8bc"/>'
      + '</svg>';
  }

  function imageUrl(fileName) {
    return BASE_URL + '/images/' + fileName;
  }

  function modalImage(fileName) {
    return '<div class="course-sync-picture" data-image="' + imageUrl(fileName) + '"></div>';
  }

  function paintModalImages(modal) {
    var boxes = modal.querySelectorAll('.course-sync-picture');
    for (var index = 0; index < boxes.length; index += 1) {
      var box = boxes[index];
      var src = box.getAttribute('data-image');
      if (!src) continue;
      box.style.setProperty('display', 'block', 'important');
      box.style.setProperty('width', '100%', 'important');
      box.style.setProperty('height', 'auto', 'important');
      var invite = Boolean(box.closest && box.closest('.course-sync-card-invite'));
      var compact = Boolean(box.closest && box.closest('.course-sync-card-stuck'));
      var height = invite ? '190px' : (compact ? '240px' : '320px');
      box.style.setProperty('min-height', height, 'important');
      box.style.setProperty('flex', invite ? '0 0 190px' : (compact ? '1 1 240px' : '1 1 auto'), 'important');
      box.style.setProperty('margin', invite || compact ? '0 0 12px' : '0 0 18px', 'important');
      box.style.setProperty('background-image', 'url("' + src + '")', 'important');
      box.style.setProperty('background-repeat', 'no-repeat', 'important');
      box.style.setProperty('background-position', 'center center', 'important');
      box.style.setProperty('background-size', 'contain', 'important');
      var images = box.querySelectorAll('img');
      for (var imageIndex = 0; imageIndex < images.length; imageIndex += 1) images[imageIndex].remove();
    }
  }

  function nextModuleHref(root) {
    var scope = root || document;
    var link = scope.querySelector ? scope.querySelector('a.track--more') : null;
    if (!link && scope.querySelector) {
      var more = scope.querySelector('.track__more');
      if (more && more.closest) link = more.closest('a');
    }
    if (!link && scope !== document) return nextModuleHref(document);
    if (!link) {
      var anchors = document.querySelectorAll('a');
      for (var index = 0; index < anchors.length; index += 1) {
        var label = anchors[index].textContent.replace(/\s+/g, ' ').trim().toLowerCase();
        if (label === 'next module') return anchors[index].href || '';
      }
      return '';
    }
    return link.href || '';
  }

  function showModuleLocked(moduleName, lessons) {
    if (stuckModalOpen()) return;
    stopPartnerWaitPoll();
    var modal = ensureModal();
    var items = lessons || [];
    var total = items.length;
    var done = items.filter(function (lesson) { return lesson.completed; }).length;
    var percent = total ? Math.round((done / total) * 100) : 0;
    var name = moduleName || 'this module';
    var rows = items.map(function (lesson, index) {
      var finished = Boolean(lesson.completed);
      return '<li>'
        + lessonIcon(index)
        + '<span class="course-sync-lesson-name">' + escapeHtml(lesson.title) + '</span>'
        + '<span class="course-sync-status ' + (finished ? 'is-done' : 'is-open') + '">'
        + (finished ? '&#10003; Done' : '&#9675; Not done')
        + '</span></li>';
    }).join('');
    var card = modal.querySelector('.course-sync-card');
    card.className = 'course-sync-card course-sync-card-partner';
    card.innerHTML = ''
      + '<button type="button" class="course-sync-x" aria-label="Close">&times;</button>'
      + '<div class="course-sync-split">'
      + '<div class="course-sync-hero">'
      + modalImage('partner-missing-course.png')
      + '<h2>Complete this module first</h2>'
      + '<p class="course-sync-lead">Mark all ' + total + ' visible lessons in ' + escapeHtml(name) + ' as complete before the next module can open.</p>'
      + '<div class="course-sync-together"><span class="course-sync-people"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="6" y="11" width="12" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></span><div><strong>Next module locked</strong><span>The next module will unlock automatically after you complete all ' + total + ' lessons.</span></div></div>'
      + '</div>'
      + '<div class="course-sync-panel">'
      + '<div class="course-sync-panel-head"><div><h3>' + escapeHtml(name) + '</h3><p>Complete all lessons to unlock the next module.</p></div>'
      + '<div class="course-sync-ring" style="--p:' + percent + '"><span><b>' + done + '/' + total + '</b><small>Completed</small></span></div></div>'
      + '<ul class="course-sync-lessons">' + rows + '</ul>'
      + '<button type="button" class="course-sync-close">Close</button>'
      + '</div></div>';
    card.querySelector('.course-sync-x').onclick = function () { hideModal(modal); };
    card.querySelector('.course-sync-close').onclick = function () { hideModal(modal); };
    modal.classList.remove('is-locked');
    revealModal(modal);
  }

  function partnerWaitModel(state) {
    var role = (state && state.label) || 'partner';
    var person = state && state.person ? state.person : {};
    var chapters = person.chapters || [];
    var total = Number(person.totalChapters || 0) || chapters.length;
    var done = Number(person.completedChapters || 0);
    if (person.completedChapters == null) {
      done = chapters.filter(function (chapter) { return chapter.completed; }).length;
    }
    var remaining = Math.max(0, total - done);
    var percent = total ? Math.round((done / total) * 100) : 0;
    var rows = chapters.map(function (chapter, index) {
      var finished = Boolean(chapter.completed);
      return '<li>'
        + lessonIcon(index)
        + '<span class="course-sync-lesson-name">' + escapeHtml(chapter.chapterName) + '</span>'
        + '<span class="course-sync-status ' + (finished ? 'is-done' : 'is-open') + '">'
        + (finished ? '&#10003; Done' : '&#9675; Not done')
        + '</span></li>';
    }).join('');
    return { role: role, total: total, done: done, remaining: remaining, percent: percent, rows: rows };
  }

  function remainingCopy(model) {
    return 'Your ' + model.role + ' still needs to complete ' + model.remaining + ' chapter' + (model.remaining === 1 ? '' : 's') + ' from this week.';
  }

  function renderPartnerWait(state) {
    var modal = ensureModal();
    var model = partnerWaitModel(state);
    var titleRole = model.role.charAt(0).toUpperCase() + model.role.slice(1);
    var card = modal.querySelector('.course-sync-card');
    card.className = 'course-sync-card course-sync-card-partner course-sync-card-wait';
    card.innerHTML = ''
      + '<button type="button" class="course-sync-x" aria-label="Close">&times;</button>'
      + '<div class="course-sync-split">'
      + '<div class="course-sync-hero">'
      + modalImage('partner-wait.png')
      + '<h2>Wait for your ' + escapeHtml(model.role) + ' to complete</h2>'
      + '<p class="course-sync-lead">Your ' + escapeHtml(model.role) + ' is currently working on the remaining chapters. Once they complete these, the next week will be unlocked for both of you.</p>'
      + '<div class="course-sync-together"><span class="course-sync-people"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M4 18c1-3 3-4 4-4s3 1 4 4M12 18c1-3 3-4 4-4s3 1 4 4"/></svg></span><div><strong>You\'re learning together</strong><span>Both of you need to complete the current week to unlock the next set of lessons.</span></div></div>'
      + '</div>'
      + '<div class="course-sync-panel">'
      + '<div class="course-sync-panel-head"><div><h3>' + escapeHtml(titleRole) + '\'s Remaining Chapters</h3><p class="course-sync-remaining">' + escapeHtml(remainingCopy(model)) + '</p></div>'
      + '<div class="course-sync-ring" style="--p:' + model.percent + '"><span><b>' + model.done + '/' + model.total + '</b><small>Completed</small></span></div></div>'
      + '<ul class="course-sync-lessons">' + model.rows + '</ul>'
      + '<div class="course-sync-actions">'
      + '<button type="button" class="course-sync-back">Back to previous week</button>'
      + '<button type="button" class="course-sync-resync">Resync status</button>'
      + '<button type="button" class="course-sync-close">Close</button>'
      + '</div>'
      + '<p class="course-sync-sync-note" aria-live="polite">Status checks every minute.</p>'
      + '</div></div>';
    card.querySelector('.course-sync-x').onclick = function () { hideModal(modal); };
    card.querySelector('.course-sync-close').onclick = function () { hideModal(modal); };
    var back = card.querySelector('.course-sync-back');
    var previousWeek = Number(state && state.weekNumber) - 1;
    if (back && previousWeek >= 1) back.setAttribute('data-week', String(previousWeek));
    modal.classList.remove('is-locked');
    revealModal(modal);
  }

  function softUpdatePartnerWait(state) {
    var card = document.querySelector('#course-sync-modal .course-sync-card-wait');
    if (!card) return false;
    var model = partnerWaitModel(state);
    var remaining = card.querySelector('.course-sync-remaining');
    if (remaining) remaining.textContent = remainingCopy(model);
    var ring = card.querySelector('.course-sync-ring');
    if (ring) {
      ring.style.setProperty('--p', String(model.percent));
      var count = ring.querySelector('b');
      if (count) count.textContent = model.done + '/' + model.total;
    }
    var list = card.querySelector('.course-sync-lessons');
    if (list) list.innerHTML = model.rows;
    return true;
  }

  function showPartnerWait(label, person, context) {
    if (stuckModalOpen()) return;
    partnerWaitState = {
      label: label || 'partner',
      person: person || {},
      weekNumber: context && context.weekNumber ? Number(context.weekNumber) : currentWeekNumber(),
      nextHref: context && context.nextHref ? context.nextHref : nextModuleHref(playlistRoot()),
    };
    renderPartnerWait(partnerWaitState);
    startPartnerWaitPoll();
  }

  function categoryIdFromHref(href) {
    var match = String(href || '').match(/categories\/(\d+)/);
    return match ? match[1] : '';
  }

  function currentCategoryId() {
    var fromPath = categoryIdFromHref(window.location.pathname);
    if (fromPath) return fromPath;
    var active = document.querySelector('a.track.track--active');
    return categoryIdFromHref(active && (active.getAttribute('href') || ''));
  }

  function collectCategoryHrefs(root) {
    if (!root || !root.querySelectorAll) return [];
    var anchors = root.querySelectorAll('a[href*="/categories/"]');
    var order = [];
    var byId = {};
    for (var index = 0; index < anchors.length; index += 1) {
      var href = anchors[index].getAttribute('href') || '';
      if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0) continue;
      var id = categoryIdFromHref(href);
      if (!id) continue;
      var isPost = /\/posts\/\d+/.test(href);
      if (!byId[id]) {
        byId[id] = { href: href, postHref: isPost ? href : '' };
        order.push(id);
      } else if (isPost && !byId[id].postHref) {
        byId[id].postHref = href;
      }
    }
    return order.map(function (id) {
      return { id: id, href: byId[id].postHref || byId[id].href };
    });
  }

  function previousWeekHrefFrom(root) {
    var list = collectCategoryHrefs(root);
    var current = currentCategoryId();
    if (!current) return { href: '', foundCurrent: false };
    for (var index = 0; index < list.length; index += 1) {
      if (list[index].id === current) {
        return { href: index > 0 ? list[index - 1].href : '', foundCurrent: true };
      }
    }
    return { href: '', foundCurrent: false };
  }

  function explicitPreviousHref() {
    var anchors = document.querySelectorAll('a');
    for (var index = 0; index < anchors.length; index += 1) {
      var label = anchors[index].textContent.replace(/\s+/g, ' ').trim().toLowerCase();
      if (label === 'previous module' || label === 'previous week') {
        return anchors[index].getAttribute('href') || '';
      }
    }
    return '';
  }

  function productOutlinePath() {
    var match = window.location.pathname.match(/\/products\/[^/]+/);
    return match ? match[0] : '';
  }

  function leaveFor(href) {
    stopPartnerWaitPoll();
    window.location.assign(href);
  }

  function outsideCategoryRoot() {
    var holder = document.createElement('div');
    var anchors = document.querySelectorAll('a[href*="/categories/"]');
    var playlist = document.querySelector('.player__playlist') || document.querySelector('.playlist');
    for (var index = 0; index < anchors.length; index += 1) {
      var anchor = anchors[index];
      if (playlist && playlist.contains(anchor)) continue;
      if (anchor.closest && anchor.closest('#course-sync-modal')) continue;
      var href = anchor.getAttribute('href') || '';
      if (!href) continue;
      var clone = document.createElement('a');
      clone.setAttribute('href', href);
      holder.appendChild(clone);
    }
    return holder;
  }

  function normalizeLabel(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function sameOriginPath(href) {
    if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0) return '';
    try {
      var url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return '';
      return url.pathname;
    } catch (error) {
      return '';
    }
  }

  function targetFromButton(button) {
    var weekNumber = button ? Number(button.getAttribute('data-week')) : 0;
    if (!weekNumber) weekNumber = Math.max(1, currentWeekNumber() - 1);
    return {
      weekNumber: weekNumber,
      chapterName: button ? (button.getAttribute('data-chapter-name') || '') : '',
      chapterId: button ? (button.getAttribute('data-chapter-id') || '') : '',
    };
  }

  function matchWeekLink(root, target) {
    var found = { exact: '', lesson: '', category: '' };
    if (!root || !root.querySelectorAll || !target) return found;
    var weekNumber = Number(target.weekNumber) || 0;
    var chapterId = target.chapterId ? String(target.chapterId) : '';
    var chapterName = normalizeLabel(target.chapterName);
    var anchors = root.querySelectorAll('a[href]');
    for (var index = 0; index < anchors.length; index += 1) {
      var href = anchors[index].getAttribute('href') || '';
      if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0) continue;
      var text = normalizeLabel(anchors[index].textContent);
      var postMatch = href.match(/posts\/(\d+)/);
      var postId = postMatch ? postMatch[1] : '';
      if (chapterId && postId === chapterId) found.exact = href;
      if (!found.exact && chapterName && text === chapterName && postId) found.exact = href;
      var weekMatch = text.match(/week\s+(\d+)/);
      if (!weekNumber || !weekMatch || Number(weekMatch[1]) !== weekNumber) continue;
      if (postId) found.lesson = found.lesson || href;
      else if (/categories\/\d+/.test(href)) found.category = found.category || href;
    }
    return found;
  }

  function hrefForChapterId(html, chapterId) {
    if (!chapterId) return '';
    var source = String(html || '').replace(/\\\//g, '/');
    var match = source.match(new RegExp('/products/[^"\'\\s<>]+/categories/\\d+/posts/' + chapterId + '\\b'));
    return match ? match[0] : '';
  }

  function discoveryPaths() {
    var paths = [];
    var seen = {};
    function add(href) {
      var path = sameOriginPath(href);
      if (!path || path === window.location.pathname || seen[path] || /\/posts\/\d+$/.test(path)) return;
      seen[path] = true;
      paths.push(path);
    }
    add(productOutlinePath());
    var playlist = document.querySelector('.player__playlist') || document.querySelector('.playlist');
    var anchors = document.querySelectorAll('a[href]');
    for (var index = 0; index < anchors.length; index += 1) {
      var anchor = anchors[index];
      if (playlist && playlist.contains(anchor)) continue;
      if (anchor.closest && anchor.closest('#course-sync-modal')) continue;
      var href = anchor.getAttribute('href') || '';
      if (href.indexOf('/products/') === -1 && href.indexOf('/categories/') === -1) continue;
      add(href);
    }
    return paths;
  }

  function resolvePreviousWeekHref(target) {
    var fallback = { lesson: '', category: '' };
    function consider(root, html) {
      var byId = hrefForChapterId(html, target.chapterId);
      if (byId) return byId;
      var found = matchWeekLink(root, target);
      if (found.exact) return found.exact;
      if (!fallback.lesson && found.lesson) fallback.lesson = found.lesson;
      if (!fallback.category && found.category) fallback.category = found.category;
      if (found.category) {
        var categoryPath = sameOriginPath(found.category);
        if (categoryPath && paths.indexOf(categoryPath) === -1 && categoryPath !== window.location.pathname) {
          paths.push(categoryPath);
        }
      }
      return '';
    }
    var paths = discoveryPaths();
    var first = consider(document, '');
    if (first) return Promise.resolve(first);
    var cursor = 0;
    function step() {
      if (cursor >= paths.length || cursor >= 6) {
        if (fallback.lesson) return Promise.resolve(fallback.lesson);
        if (fallback.category) return Promise.resolve(fallback.category);
        return Promise.reject(new Error('Previous week link was not found.'));
      }
      var path = paths[cursor];
      cursor += 1;
      return fetch(path, { credentials: 'same-origin', cache: 'no-store' }).then(function (response) {
        if (!response.ok) throw new Error('skip');
        return response.text();
      }).then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var href = consider(doc, html);
        if (href) return href;
        return step();
      }).catch(function (error) {
        if (error && error.message === 'Previous week link was not found.') throw error;
        return step();
      });
    }
    return step();
  }

  function goToPreviousWeek(button) {
    var target = targetFromButton(button);
    if (target.weekNumber < 1) {
      setSyncNote('This is the first week.', true);
      return;
    }
    if (button) {
      button.disabled = true;
      button.textContent = 'Opening...';
    }
    resolvePreviousWeekHref(target).then(function (href) {
      leaveFor(href);
    }).catch(function (error) {
      if (button) {
        button.disabled = false;
        button.textContent = 'Back to previous week';
      }
      setSyncNote(error.message || 'Could not open the previous week.', true);
    });
  }

  function setSyncNote(message, isError) {
    var note = document.querySelector('#course-sync-modal .course-sync-sync-note');
    if (!note) return;
    note.hidden = !message;
    note.textContent = message || '';
    note.classList.toggle('is-error', Boolean(isError));
  }

  function setResyncButton(busy) {
    var button = document.querySelector('#course-sync-modal .course-sync-card-wait .course-sync-resync');
    if (!button) return;
    button.disabled = Boolean(busy);
    button.textContent = busy ? 'Syncing...' : 'Resync status';
  }

  function syncClock() {
    return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function unwrapCourse(payload) {
    if (payload && payload.partner) return payload;
    if (payload && payload.data && payload.data.partner) return payload.data;
    return payload || {};
  }

  function courseSyncRequest() {
    if (kajabiUserId) return CourseApi.getCourse(kajabiUserId);
    if (accountUserId) return request('/api/v1/course/sync?userId=' + encodeURIComponent(accountUserId));
    return Promise.reject(new Error('Account is not linked yet.'));
  }

  function statusSyncRequest() {
    var query = kajabiUserId
      ? ('kajabiUserId=' + encodeURIComponent(kajabiUserId))
      : ('userId=' + encodeURIComponent(accountUserId));
    return request('/api/v1/status/sync?' + query);
  }

  function refreshPartnerWait(manual) {
    if (!partnerWaitState) return Promise.resolve();
    var requestId = ++partnerWaitRequest;
    var state = partnerWaitState;
    setResyncButton(true);
    if (manual) setSyncNote('Syncing status...');
    return Promise.all([
      courseSyncRequest(),
      statusSyncRequest().catch(function () { return null; }),
    ]).then(function (results) {
      if (requestId !== partnerWaitRequest || !partnerWaitState) return;
      var course = unwrapCourse(results[0]);
      var week = findWeek(course.partner, state.weekNumber);
      if (week && week.completed) {
        var nextHref = state.nextHref;
        var weekNumber = state.weekNumber;
        var userWeek = findWeek(course.user, weekNumber);
        stopPartnerWaitPoll();
        showWeekComplete(weekNumber, userWeek || week, nextHref);
        return;
      }
      if (week && week.chapters && week.chapters.length) partnerWaitState.person = week;
      if (course.synchronization && course.synchronization.otherRole) {
        partnerWaitState.label = course.synchronization.otherRole;
      }
      if (!softUpdatePartnerWait(partnerWaitState)) renderPartnerWait(partnerWaitState);
      setResyncButton(false);
      setSyncNote('Status synced at ' + syncClock() + '.');
    }).catch(function (error) {
      if (requestId !== partnerWaitRequest || !partnerWaitState) return;
      setResyncButton(false);
      setSyncNote(error.message || 'Could not sync status.', true);
    });
  }

  function startPartnerWaitPoll() {
    if (partnerWaitTimer || !partnerWaitState) return;
    partnerWaitTimer = window.setInterval(function () {
      refreshPartnerWait(false);
    }, 60000);
  }

  function stopPartnerWaitPoll() {
    partnerWaitState = null;
    partnerWaitRequest += 1;
    if (!partnerWaitTimer) return;
    window.clearInterval(partnerWaitTimer);
    partnerWaitTimer = null;
  }

  function finishArt() {
    return '<svg class="course-sync-art" width="230" height="112" viewBox="0 0 230 112" aria-hidden="true">'
      + '<ellipse cx="115" cy="100" rx="78" ry="8" fill="#f6e4ea"/>'
      + '<circle cx="18" cy="28" r="3" fill="#f2b8c4"/><circle cx="210" cy="24" r="3" fill="#c9b6f2"/>'
      + '<circle cx="36" cy="18" r="2" fill="#f0c36a"/><circle cx="198" cy="40" r="2" fill="#8fd0a8"/>'
      + '<path d="M70 22l4 8M160 18l-4 8" stroke="#f0c36a" stroke-width="2" stroke-linecap="round"/>'
      + '<circle cx="78" cy="40" r="14" fill="#f2c7b4"/>'
      + '<path d="M64 40c1-12 26-14 30-2" fill="#3d2b28"/>'
      + '<path d="M58 96c2-22 12-32 22-32 6 0 12 4 16 12" fill="#7a3048"/>'
      + '<path d="M92 62c10-16 22-18 28-8" fill="#f2c7b4"/>'
      + '<circle cx="154" cy="40" r="14" fill="#f2c7b4"/>'
      + '<path d="M140 46c3-16 26-16 30-2 2 5-2 8-7 8h-16c-4 0-8-2-7-6z" fill="#2b211c"/>'
      + '<path d="M150 96c0-22 10-32 20-32s18 10 20 32" fill="#f2b8c4"/>'
      + '<path d="M128 58c-8-14-18-16-24-8" fill="#f2c7b4"/>'
      + '<rect x="62" y="78" width="34" height="16" rx="3" fill="#d9c8bc"/>'
      + '<rect x="136" y="78" width="34" height="16" rx="3" fill="#d9c8bc"/>'
      + '</svg>';
  }

  function showWeekComplete(weekNumber, person, nextHref) {
    stopPartnerWaitPoll();
    if (stuckModalOpen()) return;
    var modal = ensureModal();
    var week = Number(weekNumber) || 1;
    var next = week < 8 ? week + 1 : 0;
    var chapters = person && person.chapters ? person.chapters : [];
    var total = Number(person && person.totalChapters || 0) || chapters.length;
    var done = total;
    var rows = chapters.map(function (chapter, index) {
      return '<li>'
        + lessonIcon(index)
        + '<span class="course-sync-lesson-name">' + escapeHtml(chapter.chapterName) + '</span>'
        + '<span class="course-sync-status is-done">&#10003; Done</span></li>';
    }).join('');
    var lead = next
      ? 'Great job! Both partners have completed all the lessons in Week ' + week + '. Week ' + next + ' is now unlocked for both of you.'
      : 'Great job! Both partners have completed all the lessons in Week ' + week + '.';
    var calloutTitle = next ? 'Week ' + next + ' Unlocked' : 'Course complete';
    var calloutBody = next
      ? 'You can now start the next set of lessons together.'
      : 'You have finished every week together.';
    var card = modal.querySelector('.course-sync-card');
    card.className = 'course-sync-card course-sync-card-partner';
    card.innerHTML = ''
      + '<button type="button" class="course-sync-x" aria-label="Close">&times;</button>'
      + '<div class="course-sync-split">'
      + '<div class="course-sync-hero">'
      + modalImage('week-complete.png')
      + '<h2>You both finished this week!</h2>'
      + '<p class="course-sync-lead">' + lead + '</p>'
      + '<div class="course-sync-together"><span class="course-sync-people"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="6" y="11" width="12" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></span><div><strong>' + calloutTitle + '</strong><span>' + calloutBody + '</span></div></div>'
      + '</div>'
      + '<div class="course-sync-panel">'
      + '<div class="course-sync-panel-head"><div><h3>Week ' + week + ' Progress</h3><p>All lessons completed by both partners</p></div>'
      + '<div class="course-sync-ring is-complete" style="--p:100"><span><b>' + done + '/' + total + '</b><small>Completed</small></span></div></div>'
      + '<ul class="course-sync-lessons">' + rows + '</ul>'
      + '<button type="button" class="course-sync-close">Close</button>'
      + '</div></div>';
    var destination = nextHref || (next ? nextModuleHref(playlistRoot()) : '');
    function closeComplete() {
      hideModal(modal);
      if (destination) window.location.href = destination;
    }
    card.querySelector('.course-sync-x').onclick = closeComplete;
    card.querySelector('.course-sync-close').onclick = closeComplete;
    modal.classList.remove('is-locked');
    revealModal(modal);
  }

  function showPartnerStuck(chapter) {
    stopPartnerWaitPoll();
    var modal = ensureModal();
    if (modal.classList.contains('is-open') && modal.querySelector('.course-sync-card-email')) return;
    var info = typeof chapter === 'string' ? { chapterName: chapter, weekNumber: Math.max(1, currentWeekNumber() - 1), chapterId: '' } : (chapter || {});
    var name = info.chapterName || 'the previous chapter';
    var card = modal.querySelector('.course-sync-card');
    card.className = 'course-sync-card course-sync-card-partner course-sync-card-stuck';
    card.innerHTML = ''
      + '<div class="course-sync-split">'
      + '<div class="course-sync-hero">'
      + modalImage('partner-stuck.png')
      + '</div>'
      + '<div class="course-sync-panel">'
      + '<h2>Progress was not saved</h2>'
      + '<p class="course-sync-lead">Your partner unmarked the completed progress of the previous week.</p>'
      + '<div class="course-sync-warn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg><div><strong>It looks like they are still looking at ' + escapeHtml(name) + '.</strong><span>This week stays closed until they finish that chapter again.</span></div></div>'
      + '<button type="button" class="course-sync-back">Back to previous week</button>'
      + '<p class="course-sync-sync-note" aria-live="polite" hidden></p>'
      + '</div></div>';
    var back = card.querySelector('.course-sync-back');
    if (info.weekNumber) back.setAttribute('data-week', String(info.weekNumber));
    if (info.chapterId) back.setAttribute('data-chapter-id', String(info.chapterId));
    if (info.chapterName) back.setAttribute('data-chapter-name', info.chapterName);
    modal.classList.add('is-locked');
    revealModal(modal);
  }

  function showModal(title, message, names) {
    if (stuckModalOpen()) return document.createElement('div');
    stopPartnerWaitPoll();
    var modal = ensureModal();
    resetCard(modal);
    modal.querySelector('h2').textContent = title;
    modal.querySelector('p').textContent = message;
    var body = modal.querySelector('.course-sync-body');
    body.innerHTML = '';
    if (names && names.length) {
      var list = document.createElement('ul');
      names.forEach(function (name) {
        var item = document.createElement('li');
        item.textContent = name;
        list.appendChild(item);
      });
      body.appendChild(list);
    }
    var button = modal.querySelector('button');
    button.textContent = 'Close';
    button.onclick = function () {
      hideModal(modal);
    };
    var footnote = modal.querySelector('.course-sync-footnote');
    footnote.hidden = true;
    footnote.textContent = '';
    modal.classList.remove('is-locked');
    revealModal(modal);
    return body;
  }

  function revealModal(modal) {
    modal.setAttribute('data-turbo-permanent', '');
    modal.style.setProperty('display', 'flex', 'important');
    modal.style.setProperty('position', 'fixed', 'important');
    modal.style.setProperty('inset', '0', 'important');
    modal.style.setProperty('z-index', '2147483647', 'important');
    modal.style.setProperty('align-items', 'center', 'important');
    modal.style.setProperty('justify-content', 'center', 'important');
    modal.style.setProperty('background', 'rgba(28, 22, 18, 0.55)', 'important');
    modal.style.setProperty('padding', '16px', 'important');
    modal.style.setProperty('overflow', 'hidden', 'important');
    document.documentElement.style.setProperty('overflow', 'hidden', 'important');
    document.body.style.setProperty('overflow', 'hidden', 'important');
    paintModalImages(modal);
    modal.classList.add('is-open');
  }

  function hideModal(modal) {
    if (modal.querySelector('.course-sync-card-stuck')) return;
    if (modal.querySelector('.course-sync-card-wait')) stopPartnerWaitPoll();
    modal.style.setProperty('display', 'none', 'important');
    modal.classList.remove('is-open', 'is-locked');
    document.documentElement.style.removeProperty('overflow');
    document.body.style.removeProperty('overflow');
  }

  var INVITE_PAGES = {
    one_time: 'https://www.reignitesex.com/invite-your-partner-one-time-payment',
    eight_month: 'https://www.reignitesex.com/invite-your-partner-8-monthly-payments',
  };

  function responseData(result) {
    return (result && result.data) || result || {};
  }

  function isPurchaserResult(result) {
    var data = responseData(result);
    var role = (data.user && data.user.role) || data.role || '';
    if (data.isPartner === true || role === 'PARTNER') return false;
    return data.isPurchaser === true || role === 'PRIMARY';
  }

  function purchaserNeedsPartner(result) {
    if (!isPurchaserResult(result)) return false;
    return !responseData(result).partnership;
  }

  function partnerHasSignedUp(result) {
    var partnership = responseData(result).partnership;
    return Boolean(partnership && partnership.status === 'ACTIVE' && partnership.partnerUserId);
  }

  function purchaserWaitingForSignup(result) {
    if (!isPurchaserResult(result)) return false;
    var partnership = responseData(result).partnership;
    return Boolean(partnership) && !partnerHasSignedUp(result);
  }

  function storePurchaserForInvite(result, email) {
    var data = responseData(result);
    var user = data.user || {};
    var existing = savedPurchaser() || {};
    var plan = knownPlan(existing.plan) || knownPlan(data.offerReference) || knownPlan(user.offerReference);
    var thankYou = INVITE_PAGES[plan] || existing.thankYou || '';
    var record = {
      id: user.id || data.userId || existing.id || '',
      name: user.name || data.name || existing.name || '',
      email: String(email || user.email || data.email || existing.email || '').trim().toLowerCase(),
      token: data.token || existing.token || '',
      role: user.role || data.role || existing.role || 'PRIMARY',
      kajabiUserId: user.kajabiUserId || data.kajabiUserId || existing.kajabiUserId || '',
      plan: plan,
      offerId: existing.offerId || '',
      thankYou: thankYou,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    return record;
  }

  function showAddPartnerModal(result, email) {
    stopPartnerWaitPoll();
    var saved = storePurchaserForInvite(result, email);
    var modal = ensureModal();
    var card = resetCard(modal);
    card.className = 'course-sync-card course-sync-card-partner course-sync-card-invite course-sync-card-add';
    card.innerHTML = ''
      + '<button type="button" class="course-sync-x" aria-label="Close">&times;</button>'
      + '<h2>Invite Your Partner</h2>'
      + '<p class="course-sync-lead">Invite your learning partner to join this course so you can learn together and unlock weeks in sync.</p>'
      + modalImage('invite-partner.png')
      + '<ul class="course-sync-invite-steps">'
      + inviteStep('<circle cx="9" cy="8" r="3"/><circle cx="16" cy="9" r="2.4"/><path d="M4 18c.8-3 2.6-4.5 5-4.5s4.2 1.5 5 4.5"/><path d="M14 14.6c1.2-.4 2.4 0 3.4.9 1 1.1 1.4 2.2 1.6 3.5"/>', 'Learn Together', 'Both partners complete lessons to unlock new weeks.')
      + inviteStep('<path d="M5 16V8M10 16V5M15 16v-6M19 16V7"/>', 'Stay in Sync', 'Your progress is linked, so you move forward together.')
      + inviteStep('<rect x="5" y="10" width="14" height="8" rx="1.5"/><path d="M8 10V8a4 4 0 0 1 8 0v2"/><path d="M12 13v2"/>', 'Better Results', 'Accountability and support help you complete the course.')
      + '</ul>'
      + '<button type="button" class="course-sync-invite-go">Invite your partner</button>'
      + '<p class="course-sync-sync-note" hidden></p>';
    var button = card.querySelector('.course-sync-invite-go');
    var note = card.querySelector('.course-sync-sync-note');
    card.querySelector('.course-sync-x').onclick = function () {
      hideModal(modal);
    };
    function goToInvite() {
      var latest = storePurchaserForInvite(result, email);
      if (!latest.email || !latest.thankYou) {
        note.hidden = false;
        note.classList.add('is-error');
        note.textContent = latest.email
          ? 'Your checkout plan was not saved in this browser. Finish checkout on this device, then add your partner.'
          : 'Your email was not saved in this browser. Enter the checkout email again.';
        button.disabled = true;
        return;
      }
      window.location.assign(latest.thankYou);
    }
    button.onclick = goToInvite;
    if (!saved.email || !saved.thankYou) goToInvite();
    modal.classList.remove('is-locked');
    revealModal(modal);
  }

  function inviteStep(icon, title, text) {
    return '<li><span class="course-sync-invite-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">' + icon + '</svg></span><div><strong>' + title + '</strong><span>' + text + '</span></div></li>';
  }

  function showPartnerSignupModal() {
    stopPartnerWaitPoll();
    var modal = ensureModal();
    if (modal.classList.contains('is-open') && modal.querySelector('.course-sync-card-invite')) return;
    var card = resetCard(modal);
    card.className = 'course-sync-card course-sync-card-partner course-sync-card-invite';
    card.innerHTML = ''
      + '<button type="button" class="course-sync-x" aria-label="Close">&times;</button>'
      + modalImage('partner-signup-wait.png')
      + '<h2>Your Partner Still Needs to Sign Up</h2>'
      + '<p class="course-sync-lead">We\'ve sent an invitation to your partner, but they haven\'t signed up yet. Please make sure they sign up to start the course in sync.</p>'
      + '<ul class="course-sync-invite-steps">'
      + inviteStep('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 7 9-7"/>', 'Check Their Email', 'Ask your partner to check their inbox (and spam folder) for the invitation email.')
      + inviteStep('<path d="M10 13a5 5 0 0 1 0-7l1-1a5 5 0 0 1 7 7l-1 1"/><path d="M14 11a5 5 0 0 1 0 7l-1 1a5 5 0 0 1-7-7l1-1"/>', 'Complete Sign Up', 'They need to click the invite link and create their account.')
      + inviteStep('<circle cx="9" cy="8" r="3"/><circle cx="16" cy="9" r="2.4"/><path d="M4 18c.8-3 2.6-4.5 5-4.5s4.2 1.5 5 4.5"/><path d="M14 14.6c1.2-.4 2.4 0 3.4.9 1 1.1 1.4 2.2 1.6 3.5"/>', 'Start Learning Together', 'Once they sign up, your course weeks will be unlocked together.')
      + '</ul>'
      + '<button type="button" class="course-sync-invite-resync">Resync status</button>'
      + '<p class="course-sync-sync-note" hidden></p>';
    var button = card.querySelector('.course-sync-invite-resync');
    var note = card.querySelector('.course-sync-sync-note');
    card.querySelector('.course-sync-x').onclick = function () {
      hideModal(modal);
    };
    button.onclick = function () {
      var saved = savedPurchaser() || {};
      var id = kajabiUserId || saved.kajabiUserId || '';
      if (!id) {
        note.hidden = false;
        note.classList.add('is-error');
        note.textContent = 'Sign in again, then resync your partner status.';
        return;
      }
      button.disabled = true;
      button.textContent = 'Syncing...';
      note.hidden = true;
      note.classList.remove('is-error');
      CourseApi.lookup(id).then(function (result) {
        if (partnerHasSignedUp(result)) {
          markIdentity(result, id);
          hideModal(modal);
          handleKnownUser();
          return;
        }
        button.disabled = false;
        button.textContent = 'Resync status';
        note.hidden = false;
        note.textContent = 'Your partner still has not signed up.';
      }).catch(function (error) {
        button.disabled = false;
        button.textContent = 'Resync status';
        note.hidden = false;
        note.classList.add('is-error');
        note.textContent = error.message || 'Could not check your partner.';
      });
    };
    modal.classList.remove('is-locked');
    revealModal(modal);
  }

  function continueAfterIdentity(result, email) {
    if (purchaserNeedsPartner(result)) {
      showAddPartnerModal(result, email);
      return;
    }
    if (purchaserWaitingForSignup(result)) {
      showPartnerSignupModal();
      return;
    }
    handleKnownUser();
  }

  function showEmailModal() {
    stopPartnerWaitPoll();
    var modal = ensureModal();
    if (modal.classList.contains('is-locked') && modal.classList.contains('is-open')) return;
    var card = resetCard(modal);
    card.className = 'course-sync-card course-sync-card-partner course-sync-card-email';
    card.innerHTML = ''
      + '<div class="course-sync-split">'
      + '<div class="course-sync-hero">'
      + modalImage('course-email.png')
      + '<div class="course-sync-together"><span class="course-sync-people"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/></svg></span><div><strong>Your progress is safe</strong><span>We\'ll securely link your learning account to this email address.</span></div></div>'
      + '</div>'
      + '<div class="course-sync-panel">'
      + '<h2>Save Your Course Progress</h2>'
      + '<p class="course-sync-lead">Enter the email address you use to access this course so we can securely link your learning account.</p>'
      + '<ul class="course-sync-reasons">'
      + '<li><span class="course-sync-reason-icon" style="background:#fdecef;color:#c45c78"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19h16"/><path d="M7 16v-4M12 16V8M17 16v-6"/></svg></span><div><strong>Save Your Progress</strong><span>Keep your course progress linked to your email address.</span></div></li>'
      + '<li><span class="course-sync-reason-icon" style="background:#efe7ff;color:#7c3aed"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3.5 19c.8-3 2.8-4.5 5.5-4.5s4.7 1.5 5.5 4.5"/><path d="M14.5 14.6c1.4-.3 2.7 0 3.8 1 1 1.1 1.5 2.3 1.7 3.4"/></svg></span><div><strong>Sync With Your Partner</strong><span>Connect your account with your partner\'s account so both learning journeys stay synchronized.</span></div></li>'
      + '<li><span class="course-sync-reason-icon" style="background:#e7f8ef;color:#2f9d62"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="6" y="11" width="12" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></span><div><strong>Unlock Course Weeks Together</strong><span>Course content will automatically become available as you and your partner complete the required lessons.</span></div></li>'
      + '</ul>'
      + '<p class="course-sync-note" hidden></p>'
      + '<label for="course-sync-email">Email Address <span class="course-sync-req">*</span></label>'
      + '<div class="course-sync-field"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 7 9-7"/></svg>'
      + '<input id="course-sync-email" type="email" autocomplete="email" placeholder="Enter your registered email address"></div>'
      + '<button type="button" class="course-sync-continue">Continue &#8594;</button>'
      + '<div class="course-sync-warn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg><div><strong>You\'ll only need to do this once. Please use the same email address you use for your course account.</strong><span>Use the email address associated with your Kajabi course account. Using a different email may prevent your progress from syncing correctly.</span></div></div>'
      + '</div></div>';
    modal.classList.add('is-locked');
    revealModal(modal);
    var note = card.querySelector('.course-sync-note');
    var input = card.querySelector('#course-sync-email');
    var button = card.querySelector('button');
    function showEmailError(message) {
      note.hidden = false;
      note.textContent = message;
      input.classList.add('course-sync-input-error');
    }
    input.addEventListener('input', function () {
      input.classList.remove('course-sync-input-error');
      note.hidden = true;
    });
    button.disabled = false;
    button.onclick = function () {
      var email = input.value.trim();
      if (!email) {
        showEmailError('Enter your registered email address.');
        return;
      }
      button.disabled = true;
      input.classList.remove('course-sync-input-error');
      note.hidden = true;
      CourseApi.bindAccount({ email: email, kajabiUserId: kajabiUserId }).then(function (result) {
        markIdentity(result, kajabiUserId);
        hideModal(modal);
        continueAfterIdentity(result, email);
      }).catch(function (error) {
        button.disabled = false;
        if (error.status === 404) {
          showEmailError('We could not find that email. Enter the same email you use to log in.');
        } else if (error.status === 409) {
          showEmailError('That email is already connected to a login. Enter the email for this sign-in.');
        } else {
          showEmailError(error.message);
        }
      });
    };
  }

  function markIdentity(result, id) {
    var record = savePurchaser(result);
    accountUserId = record.id ? String(record.id) : '';
    if (id) kajabiUserId = id;
    identityReady = true;
    if (kajabiUserId) localStorage.setItem('courseSync.linkedId', kajabiUserId);
    startStatusPoll();
  }

  function startStatusPoll() {
    if (statusPollTimer || (!kajabiUserId && !accountUserId)) return;
    function tick() {
      var query = kajabiUserId
        ? ('kajabiUserId=' + encodeURIComponent(kajabiUserId))
        : ('userId=' + encodeURIComponent(accountUserId));
      request('/api/v1/status/sync?' + query).catch(function () {});
    }
    tick();
    statusPollTimer = window.setInterval(tick, 60000);
  }

  function visibleChapters(override) {
    var lessons = moduleLessons(playlistRoot());
    var chapters = [];
    for (var index = 0; index < lessons.length; index += 1) {
      var lesson = lessons[index];
      if (!lesson.title || lesson.weekNumber < 1 || lesson.weekNumber > 8) continue;
      var completed = lesson.completed;
      if (override && lesson.chapterId === override.chapterId) completed = override.completed;
      chapters.push({
        chapterName: lesson.title,
        weekNumber: lesson.weekNumber,
        chapterId: lesson.chapterId,
        completed: completed,
      });
    }
    if (override && override.chapterId && !chapters.some(function (chapter) { return chapter.chapterId === override.chapterId; })) {
      var current = readLesson();
      if (current.title && current.weekNumber >= 1 && current.weekNumber <= 8) {
        chapters.push({
          chapterName: current.title,
          weekNumber: current.weekNumber,
          chapterId: current.chapterId,
          completed: override.completed,
        });
      }
    }
    return chapters.filter(function (chapter) { return chapter.chapterName && chapter.chapterId; });
  }

  function progressBody(chapters) {
    var body = { chapters: chapters };
    if (accountUserId) body.userId = Number(accountUserId);
    if (kajabiUserId) body.kajabiUserId = kajabiUserId;
    return body;
  }

  function syncVisibleProgress(override, announce) {
    if (!identityReady) {
      pendingCompletion = override || pendingCompletion;
      return Promise.resolve(null);
    }
    var chapters = visibleChapters(override);
    if (!chapters.length) return Promise.resolve(null);
    return CourseApi.updateChapterProgress(progressBody(chapters)).then(function (result) {
      if (!announce) return result;
      var updates = result.data && result.data.updates ? result.data.updates : [];
      var update = updates[updates.length - 1];
      if (!update || !update.user || !update.user.completed) return result;
      return CourseApi.getCourse(kajabiUserId).then(function (course) {
        var week = findWeek(course.partner, update.weekNumber);
        var label = otherRole(course);
        var waiting = !(update.partner && update.partner.completed);
        if (waiting) {
          showPartnerWait(label, week || update.partner, {
            weekNumber: update.weekNumber,
            nextHref: nextModuleHref(playlistRoot()),
          });
        } else {
          showWeekComplete(update.weekNumber, week || update.user, nextModuleHref(playlistRoot()));
        }
        return result;
      });
    });
  }

  function currentWeekNumber() {
    var lesson = readLesson();
    if (lesson.weekNumber >= 1 && lesson.weekNumber <= 8) return lesson.weekNumber;
    var fromPlaylist = weekNumberFromPlaylist(playlistRoot());
    return fromPlaylist >= 1 && fromPlaylist <= 8 ? fromPlaylist : 0;
  }

  function partnerStuckChapter(course, weekNumber) {
    if (!course || weekNumber < 2) return null;
    for (var week = 1; week < weekNumber; week += 1) {
      var userWeek = findWeek(course.user, week);
      var partnerWeek = findWeek(course.partner, week);
      if (!userWeek || !userWeek.completed) continue;
      if (!partnerWeek || partnerWeek.completed) continue;
      var chapters = partnerWeek.chapters || [];
      for (var index = 0; index < chapters.length; index += 1) {
        if (chapters[index].completed) continue;
        return {
          chapterName: chapters[index].chapterName || ('Week ' + week),
          chapterId: chapters[index].chapterId || '',
          weekNumber: week,
        };
      }
      return { chapterName: 'Week ' + week, chapterId: '', weekNumber: week };
    }
    return null;
  }

  function isWeekLocked(error) {
    var code = error && error.body && error.body.errorCode;
    if (code === 'WEEK_LOCKED') return true;
    return /cannot access this week/i.test((error && error.message) || '');
  }

  function stuckModalOpen() {
    var modal = document.getElementById('course-sync-modal');
    return Boolean(modal && modal.classList.contains('is-open') && modal.querySelector('.course-sync-card-stuck'));
  }

  function openPartnerStuck(weekNumber) {
    var week = weekNumber || currentWeekNumber();
    if (!kajabiUserId || week < 2) return Promise.resolve(false);
    return CourseApi.getCourse(kajabiUserId).then(function (course) {
      var stuck = partnerStuckChapter(course, week);
      if (!stuck || !stuck.chapterName) return false;
      showPartnerStuck(stuck);
      return true;
    }).catch(function () {
      return false;
    });
  }

  function reportProgressError(error, title) {
    if (stuckModalOpen()) return;
    if (isWeekLocked(error)) {
      openPartnerStuck(currentWeekNumber()).then(function (shown) {
        if (!shown && !stuckModalOpen()) showModal(title || 'Progress was not saved', error.message);
      });
      return;
    }
    showModal(title || 'Progress was not saved', error.message);
  }

  function handleKnownUser() {
    var weekNumber = currentWeekNumber();
    if (weekNumber >= 2) openPartnerStuck(weekNumber);
    if (!isLessonPage()) return;
    watchLesson();
    watchPlaylistChecks();
    var override = pendingCompletion;
    pendingCompletion = null;
    syncVisibleProgress(override, Boolean(override)).catch(function (error) {
      if (override && !isMissingIdentity(error)) {
        paintLessonCheck(override.chapterId, !override.completed);
        reportProgressError(error, 'Progress was not saved');
      }
    });
  }

  function handleMissingUser() {
    identityReady = false;
    localStorage.removeItem('courseSync.linkedId');
    showEmailModal();
  }

  var lessonWatchBound = false;

  function watchLesson() {
    if (lessonWatchBound) return;
    lessonWatchBound = true;
    document.addEventListener('click', function (event) {
      var node = event.target && event.target.nodeType === 1 ? event.target : event.target.parentElement;
      if (!node || !node.closest) return;
      var complete = node.closest('.btn--completion, .mark-as-complete a');
      if (complete) {
        saveCurrentLesson(complete);
        return;
      }
      var control = node.closest('a.track--more, a');
      if (!control) return;
      var isNextModule = control.classList.contains('track--more') || Boolean(control.querySelector('.track__more'));
      if (!isNextModule) {
        var label = control.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
        isNextModule = label === 'next module';
      }
      if (isNextModule) blockNextModule(event, control);
    }, true);
  }

  function saveCurrentLesson(control) {
    var lesson = readLesson();
    if (!lesson.title || lesson.weekNumber < 1 || lesson.weekNumber > 8) {
      showModal('Progress was not saved', 'This lesson could not be matched to one of the 8 course weeks.');
      return;
    }
    var completed = !control || control.getAttribute('data-post-completion-toggle') !== 'true';
    paintLessonCheck(lesson.chapterId, completed);
    syncVisibleProgress({ chapterId: lesson.chapterId, completed: completed }, true).catch(function (error) {
      if (!isMissingIdentity(error)) {
        paintLessonCheck(lesson.chapterId, !completed);
        reportProgressError(error, 'Progress was not saved');
      }
    });
  }

  function progressLines(person) {
    if (!person || !person.chapters || !person.chapters.length) return [];
    return person.chapters.map(function (chapter) {
      return chapter.chapterName + (chapter.completed ? ' — done' : ' — not done');
    });
  }

  function progressSentence(person, label) {
    if (!person) return 'Your ' + label + ' has not started this week.';
    var done = Number(person.completedChapters || 0);
    var total = Number(person.totalChapters || 0);
    if (!total) return 'Your ' + label + ' has no saved lessons for this week yet.';
    return 'Your ' + label + ' has finished ' + done + ' of ' + total + ' lessons in this week.';
  }

  function blockNextModule(event, control) {
    event.preventDefault();
    event.stopPropagation();
    var playlist = playlistRoot(control);
    var weekNumber = weekNumberFromPlaylist(playlist);
    var moduleName = playlistTitle(playlist) || ('Week ' + weekNumber);
    if (weekNumber < 1 || weekNumber > 8) {
      showModal('Could not read this module', 'Each visible playlist needs to be one of the 8 course weeks before the next module can open.');
      return;
    }
    var lessons = moduleLessons(playlist);
    var missing = lessons.filter(function (lesson) { return lesson.title && !lesson.completed; });
    if (!lessons.length || missing.length) {
      showModuleLocked(moduleName, lessons);
      return;
    }
    if (!identityReady) {
      showEmailModal();
      return;
    }
    CourseApi.updateChapterProgress(progressBody(lessons.map(function (lesson) {
      return {
        chapterName: lesson.title,
        weekNumber: weekNumber,
        chapterId: lesson.chapterId,
        completed: true,
      };
    }))).then(function (result) {
      var updates = result.data && result.data.updates ? result.data.updates : [];
      var update = updates[updates.length - 1];
      if (!update) {
        showModal('Could not check your partner', 'Week status did not come back.');
        return;
      }
      var label = update.otherRole || 'partner';
      var partnerDone = update.partner && update.partner.completed;
      var bothDone = update.partnership && update.partnership.weekCompleted;
      if (!partnerDone || !bothDone) {
        var person = update.partner || {};
        if (!person.chapters || !person.chapters.length) {
          person = {
            completedChapters: person.completedChapters || 0,
            totalChapters: person.totalChapters || lessons.length,
            chapters: lessons.map(function (lesson) {
              return { chapterName: lesson.title, completed: false };
            }),
          };
        }
        showPartnerWait(label, person, {
          weekNumber: weekNumber,
          nextHref: control.href || nextModuleHref(playlist),
        });
        return;
      }
      showWeekComplete(weekNumber, update.user, control.href || nextModuleHref(playlist));
    }).catch(function (error) {
      reportProgressError(error, 'Could not open the next module');
    });
  }

  function lookupKnownIdentity(ids, index) {
    if (index >= ids.length) {
      kajabiUserId = readCookie('rl_user_id') || siteMemberId();
      handleMissingUser();
      return;
    }
    CourseApi.lookup(ids[index]).then(function (result) {
      markIdentity(result, ids[index]);
      continueAfterIdentity(result);
    }).catch(function (error) {
      if (isMissingIdentity(error)) {
        lookupKnownIdentity(ids, index + 1);
        return;
      }
      showModal('Could not check your account', error.message);
    });
  }

  function boot() {
    var ids = identityCandidates();
    kajabiUserId = ids[0] || '';
    if (isLessonPage()) {
      watchLesson();
      watchPlaylistChecks();
    }
    if (!ids.length) return;
    lookupKnownIdentity(ids, 0);
  }

  var api = {
    registerPurchaser: function (input, extra) {
      return request('/api/v1/users/register', {
        method: 'POST',
        admin: true,
        keepalive: extra && extra.keepalive,
        body: compact({ name: input.name, email: input.email }),
      });
    },
    lookup: function (id) {
      return request('/api/v1/users/lookup?kajabiUserId=' + encodeURIComponent(id), {
        admin: true,
      });
    },
    bindAccount: function (input) {
      return request('/api/v1/users/bind', {
        method: 'POST',
        admin: true,
        body: compact(input),
      });
    },
    linkPartner: function (input) {
      return request('/api/v1/partners/link', {
        method: 'POST',
        admin: !input.token,
        token: input.token,
        body: compact({
          partnerName: input.partnerName,
          partnerEmail: input.partnerEmail,
          purchaserUserId: input.purchaserUserId,
          purchaserEmail: input.purchaserEmail,
        }),
      });
    },
    getCourse: function (id) {
      return request('/api/v1/course/sync?kajabiUserId=' + encodeURIComponent(id));
    },
    syncStatus: function (id) {
      return request('/api/v1/status/sync?kajabiUserId=' + encodeURIComponent(id));
    },
    updateChapterProgress: function (input) {
      return request('/api/v1/chapters/progress', {
        method: 'POST',
        keepalive: true,
        body: input,
      });
    },
  };

  document.addEventListener('turbo:load', boot);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  return api;
})();
